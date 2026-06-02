import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentUsage } from "../src/agent.js";
import { WorkflowManager } from "../src/workflow-manager.js";

/** Agent runner that reports fixed usage so token accounting is exercised. */
function fakeAgent(usage: Partial<AgentUsage> = {}, result: unknown = "ok") {
  return {
    async run(_prompt: string, options: { onUsage?: (u: AgentUsage) => void }) {
      options.onUsage?.({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        cost: 0,
        ...usage,
      });
      return result;
    },
  };
}

/** Agent that stays running until a deferred resolve is called externally. */
function deferredAgent() {
  let deferredResolve: ((value: unknown) => void) | null = null;
  let deferredReject: ((err: Error) => void) | null = null;
  const promise = new Promise((resolve, reject) => {
    deferredResolve = resolve;
    deferredReject = reject;
  });
  return {
    resolve: (value: unknown = "done") => deferredResolve?.(value),
    reject: (err: Error) => deferredReject?.(err),
    runner: {
      async run(_prompt: string, _options?: { onUsage?: (u: AgentUsage) => void }) {
        return promise;
      },
    },
  };
}

const oneAgentScript = `export const meta = { name: 'tracked_demo', description: 'one agent' }
phase('Work')
const a = await agent('do it', { label: 'a' })
return { a }`;

/** Run each manager test in its own temp cwd so .pi/workflows/runs is isolated. */
function withTempCwd(fn: (cwd: string) => Promise<void>) {
  return async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-dw-mgr-"));
    try {
      await fn(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}

test(
  "runSync registers the run so /workflows (listRuns) can see it",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent({ input: 100, output: 40, total: 140 }) });
    const events: string[] = [];
    for (const ev of ["agentStart", "agentEnd", "phase", "complete"]) {
      manager.on(ev, () => events.push(ev));
    }
    let progressCalls = 0;
    const result = await manager.runSync(oneAgentScript, undefined, {
      onProgress: () => { progressCalls++; },
    });

    assert.equal(result.agentCount, 1);
    assert.ok(progressCalls > 0, "onProgress should fire while the run executes");
    assert.ok(events.includes("agentStart") && events.includes("complete"), "manager emits live events");

    const runs = manager.listRuns();
    assert.equal(runs.length, 1, "the sync run is persisted and listable");
    assert.equal(runs[0].workflowName, "tracked_demo");
    assert.equal(runs[0].status, "completed");
    assert.equal(runs[0].tokenUsage?.total, 140, "token usage is persisted for the navigator");
  }),
);

test(
  "runSync persists the run immediately (visible while still running)",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    let listedWhileRunning = 0;
    manager.on("agentStart", () => {
      listedWhileRunning = manager.listRuns().filter((r) => r.status === "running").length;
    });
    await manager.runSync(oneAgentScript);
    assert.equal(listedWhileRunning, 1, "the run shows as running in listRuns mid-flight");
  }),
);

test(
  "each agent's model is recorded for /workflows: explicit opts.model, else the main model",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent(), mainModel: "anthropic/claude-opus-4-8" });
    const script = `export const meta = { name: 'model_demo', description: 'per-agent models' }
const a = await agent('explore', { label: 'scan', model: 'openai/gpt-5-mini' })
const b = await agent('reason', { label: 'judge' })
return { a, b }`;
    await manager.runSync(script);

    const run = manager.listRuns().find((r) => r.workflowName === "model_demo");
    const byLabel = Object.fromEntries((run?.agents ?? []).map((a) => [a.label, a.model]));
    assert.equal(byLabel.scan, "openai/gpt-5-mini", "explicit per-agent model is recorded");
    assert.equal(byLabel.judge, "anthropic/claude-opus-4-8", "default agent shows the main model");
  }),
);

test(
  "startInBackground returns immediately with runId and promise",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    assert.ok(runId, "should generate a run id");
    assert.ok(promise instanceof Promise, "should return a promise");
    const runs = manager.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, runId);
    assert.equal(runs[0].status, "running");
    await promise;
  }),
);

test(
  "startInBackground result resolves on completion",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent({ total: 50 }) });
    const { promise } = manager.startInBackground(oneAgentScript);
    const result = await promise;
    assert.equal(result.agentCount, 1);
    assert.equal(result.meta.name, "tracked_demo");
  }),
);

test(
  "stop stops a running workflow and transitions to aborted",
  withTempCwd(async (cwd) => {
    const da = deferredAgent();
    const manager = new WorkflowManager({ cwd, agent: da.runner });
    // Suppress the expected unhandled rejection from the aborted run
    manager.on("error", () => {});
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    // Wait a tick for the run to start processing
    await new Promise((r) => setTimeout(r, 20));
    const stopped = manager.stop(runId);
    assert.equal(stopped, true);
    const run = manager.getRun(runId);
    assert.equal(run?.status, "aborted", "run should be aborted");
    // Clean up: resolve the deferred agent and catch the expected rejection
    da.resolve("done");
    await promise.catch(() => {});
  }),
);

test(
  "stop returns false for nonexistent run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    assert.equal(manager.stop("nonexistent"), false);
  }),
);

test(
  "pause pauses a running workflow",
  withTempCwd(async (cwd) => {
    const da = deferredAgent();
    const manager = new WorkflowManager({ cwd, agent: da.runner });
    manager.on("error", () => {});
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    await new Promise((r) => setTimeout(r, 20));
    const paused = manager.pause(runId);
    assert.equal(paused, true);
    const run = manager.getRun(runId);
    assert.equal(run?.status, "paused", "run should be paused");
    da.resolve("done");
    await promise.catch(() => {});
  }),
);

test(
  "pause returns false for nonexistent run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    assert.equal(manager.pause("nonexistent"), false);
  }),
);

test(
  "getRun returns undefined for unknown run id",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    const run = manager.getRun("no-such-run");
    assert.equal(run, undefined);
  }),
);

test(
  "getSnapshot returns null for unknown run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    const snap = manager.getSnapshot("unknown");
    assert.equal(snap, null);
  }),
);

test(
  "deleteRun removes the run from memory and persistence",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    const { runId } = manager.startInBackground(oneAgentScript);
    // Wait for completion first (fast agent)
    await new Promise((r) => setTimeout(r, 30));
    const deleted = manager.deleteRun(runId);
    assert.equal(deleted, true);
    assert.equal(manager.getRun(runId), undefined);
  }),
);

test(
  "deleteRun returns false for nonexistent run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    assert.equal(manager.deleteRun("nonexistent"), false);
  }),
);

test(
  "setMainModel sets the main model used for default agents",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    manager.setMainModel("anthropic/claude-sonnet-4");
    const script = `export const meta = { name: 'mm_test', description: 'main model test' }
const a = await agent('test', { label: 'a' })
return { a }`;
    await manager.runSync(script);
    const run = manager.listRuns().find((r) => r.workflowName === "mm_test");
    assert.ok(run, "run should exist");
  }),
);

test(
  "getPersistence returns the persistence layer",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    const p = manager.getPersistence();
    assert.ok(p);
    assert.equal(typeof p.save, "function");
    assert.equal(typeof p.list, "function");
  }),
);

test(
  "runSync emits manager events (agentStart -> agentEnd -> complete)",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    const events: string[] = [];
    manager.on("agentStart", () => events.push("agentStart"));
    manager.on("agentEnd", () => events.push("agentEnd"));
    manager.on("complete", () => events.push("complete"));
    await manager.runSync(oneAgentScript);
    assert.deepEqual(events, ["agentStart", "agentEnd", "complete"]);
  }),
);

test(
  "resume returns false when run is already running",
  withTempCwd(async (cwd) => {
    const da = deferredAgent();
    const manager = new WorkflowManager({ cwd, agent: da.runner });
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    await new Promise((r) => setTimeout(r, 20));
    const resumed = await manager.resume(runId);
    assert.equal(resumed, false);
    da.resolve("done");
    await promise.catch(() => {});
  }),
);

test(
  "resume returns false when run doesn't exist",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd });
    const resumed = await manager.resume("nonexistent");
    assert.equal(resumed, false);
  }),
);

test(
  "manager emits complete event with runId",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    let capturedId = "";
    manager.on("complete", ({ runId }: { runId: string }) => { capturedId = runId; });
    await manager.runSync(oneAgentScript);
    assert.ok(capturedId, "should capture runId on complete");
  }),
);

test(
  "stop returns false for completed/aborted run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    await promise; // wait for completion
    const stopped = manager.stop(runId);
    assert.equal(stopped, false, "cannot stop an already completed run");
  }),
);

test(
  "pause returns false for completed run",
  withTempCwd(async (cwd) => {
    const manager = new WorkflowManager({ cwd, agent: fakeAgent() });
    const { runId, promise } = manager.startInBackground(oneAgentScript);
    await promise; // wait for completion
    const paused = manager.pause(runId);
    assert.equal(paused, false, "cannot pause completed run");
  }),
);
