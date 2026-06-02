import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function loadErrors() {
  return import("../dist/errors.js");
}

async function loadConfig() {
  return import("../dist/config.js");
}

async function loadLogger() {
  return import("../dist/logger.js");
}

// ─── Errors ────────────────────────────────────────────────────────────────────

describe("errors", () => {
  it("WorkflowError stores code and message", async () => {
    const { WorkflowError, WorkflowErrorCode } = await loadErrors();
    const err = new WorkflowError("test error", WorkflowErrorCode.EXECUTION_FAILED);
    assert.equal(err.message, "test error");
    assert.equal(err.code, WorkflowErrorCode.EXECUTION_FAILED);
    assert.ok(err instanceof Error);
  });

  it("WorkflowError can have an agent label", async () => {
    const { WorkflowError, WorkflowErrorCode } = await loadErrors();
    const err = new WorkflowError("err", WorkflowErrorCode.TIMEOUT, { agentLabel: "agent-1" });
    assert.equal(err.agentLabel, "agent-1");
  });

  it("isWorkflowError detects WorkflowError", async () => {
    const { WorkflowError, WorkflowErrorCode, isWorkflowError } = await loadErrors();
    const err = new WorkflowError("msg", WorkflowErrorCode.ABORTED);
    assert.equal(isWorkflowError(err), true);
    assert.equal(isWorkflowError(new Error("plain")), false);
    assert.equal(isWorkflowError("string"), false);
    assert.equal(isWorkflowError(null), false);
  });

  it("isAbortError detects AbortError", async () => {
    const { isAbortError } = await loadErrors();
    assert.equal(isAbortError(new DOMException("aborted", "AbortError")), true);
    assert.equal(isAbortError(new Error("normal")), false);
  });

  it("isTimeoutError matches timeout-related messages", async () => {
    const { isTimeoutError, WorkflowError, WorkflowErrorCode } = await loadErrors();
    assert.equal(isTimeoutError(new Error("timeout exceeded")), true);
    assert.equal(isTimeoutError(new Error("timeout exceeded")), true);
    assert.equal(isTimeoutError(new WorkflowError("normal", WorkflowErrorCode.EXECUTION_FAILED)), false);
  });

  it("wrapError wraps non-WorkflowError", async () => {
    const { wrapError, WorkflowErrorCode, isWorkflowError } = await loadErrors();
    const result = wrapError(new Error("raw"));
    assert.equal(isWorkflowError(result), true);
    assert.equal(result.code, WorkflowErrorCode.AGENT_EXECUTION_ERROR);
  });

  it("wrapError passes through WorkflowError unchanged", async () => {
    const { wrapError, WorkflowError, WorkflowErrorCode } = await loadErrors();
    const original = new WorkflowError("already wrapped", WorkflowErrorCode.TIMEOUT);
    const result = wrapError(original);
    assert.equal(result, original);
  });

  it("wrapError adds agent label context", async () => {
    const { wrapError, WorkflowErrorCode } = await loadErrors();
    const result = wrapError(new Error("fail"), { agentLabel: "agent-x" });
    assert.equal(result.agentLabel, "agent-x");
  });
});

// ─── Config ────────────────────────────────────────────────────────────────────

describe("config", () => {
  it("exports expected constants", async () => {
    const c = await loadConfig();
    assert.equal(c.MAX_AGENTS_PER_RUN, 1000);
    assert.equal(c.MAX_CONCURRENCY, 16);
    assert.equal(c.DEFAULT_AGENT_TIMEOUT_MS, 5 * 60 * 1000);
    assert.equal(c.WORKFLOW_RUNS_DIR, ".pi/workflows/runs");
    assert.equal(c.WORKFLOW_SAVED_DIR, ".pi/workflows/saved");
  });
});

// ─── Logger ────────────────────────────────────────────────────────────────────

describe("logger", () => {
  it("createWorkflowLogger returns logger with log/error/warn/getLogs", async () => {
    const { createWorkflowLogger } = await loadLogger();
    const log = createWorkflowLogger({ persist: false });
    assert.equal(typeof log.log, "function");
    assert.equal(typeof log.error, "function");
    assert.equal(typeof log.warn, "function");
    assert.equal(typeof log.getLogs, "function");
  });

  it("log/error/warn do not throw and accumulate logs", async () => {
    const { createWorkflowLogger } = await loadLogger();
    const log = createWorkflowLogger({ persist: false });
    log.log("test info");
    log.warn("test warn");
    log.error("test error");
    const logs = log.getLogs();
    assert.equal(logs.length, 3);
    assert.ok(logs[0].includes("test info"));
    assert.ok(logs[1].includes("test warn"));
    assert.ok(logs[2].includes("test error"));
  });
});

// ─── Display ───────────────────────────────────────────────────────────────────

describe("display", () => {
  it("preview truncates long values", async () => {
    const { preview } = await load();
    const long = "x".repeat(200);
    const result = preview(long, 10);
    assert.ok(result.length <= 13); // 10 + "…" (3 bytes)
  });

  it("preview returns full short values", async () => {
    const { preview } = await load();
    const result = preview("hello");
    assert.equal(result, "hello");
  });

  it("preview handles objects", async () => {
    const { preview } = await load();
    const result = preview({ a: 1, b: 2 }, 50);
    assert.ok(result.length > 0);
  });

  it("preview handles null/undefined", async () => {
    const { preview } = await load();
    assert.equal(preview("null"), "null");
    assert.equal(preview(undefined), "");
  });

  it("createWorkflowSnapshot creates snapshot from meta", async () => {
    const { createWorkflowSnapshot } = await load();
    const meta = {
      name: "test",
      description: "test workflow",
      phases: [{ title: "phase-1" }, { title: "phase-2" }],
    };
    const snap = createWorkflowSnapshot(meta as never);
    assert.equal(snap.name, "test");
    assert.equal(snap.phases.length, 2);
    assert.equal(snap.phases[0], "phase-1");
    assert.equal(snap.agentCount, 0);
  });

  it("recomputeWorkflowSnapshot recalculates status", async () => {
    const { createWorkflowSnapshot, recomputeWorkflowSnapshot } = await load();
    const meta = { name: "t", description: "d", phases: [{ title: "p1" }] };
    const snap = createWorkflowSnapshot(meta as never);
    snap.agents = [
      { id: "a1", status: "done", step: "s1", phase: "p1" },
      { id: "a2", status: "running", step: "s2", phase: "p1" },
    ];
    const recomputed = recomputeWorkflowSnapshot(snap);
    assert.equal(recomputed.agentCount, 2);
  });

  it("renderWorkflowText returns a non-empty string", async () => {
    const { createWorkflowSnapshot, renderWorkflowText } = await load();
    const meta = { name: "test-wf", description: "d", phases: [{ title: "research" }] };
    const snap = createWorkflowSnapshot(meta as never);
    const text = renderWorkflowText(snap);
    assert.ok(text.includes("test-wf"));
    assert.ok(text.length > 0);
  });

  it("renderWorkflowLines returns array of lines", async () => {
    const { createWorkflowSnapshot, renderWorkflowLines } = await load();
    const meta = { name: "wf", description: "d", phases: [{ title: "p1" }] };
    const snap = createWorkflowSnapshot(meta as never);
    const lines = renderWorkflowLines(snap);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length > 0);
  });
});

async function load() {
  return import("../dist/display.js");
}
