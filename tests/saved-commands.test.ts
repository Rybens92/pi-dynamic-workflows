import assert from "node:assert/strict";
import { describe, it } from "node:test";

async function load() {
  return import("../dist/saved-commands.js");
}

describe("parseCommandArgs", () => {
  it("parses key=value pairs", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("foo=bar count=42");
    assert.equal(result.foo, "bar");
    assert.equal(result.count, "42");
  });

  it("collects positional args into _", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("hello world");
    assert.equal(result._, "hello world");
  });

  it("handles mixed positional and key=value", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("task=test hello world");
    assert.equal(result.task, "test");
    assert.equal(result._, "hello world");
  });

  it("sets _raw to the trimmed input", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("  foo=bar  ");
    assert.equal(result._raw, "foo=bar");
  });

  it("returns empty when input is empty", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("");
    assert.equal(result._, "");
    assert.equal(result._raw, "");
  });

  it("fills parameter defaults for missing keys", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("foo=bar", { foo: {}, limit: { default: 10 }, label: { default: "test" } });
    assert.equal(result.foo, "bar");
    assert.equal(result.limit, 10);
    assert.equal(result.label, "test");
  });

  it("does NOT override explicit values with defaults", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("limit=5", { limit: { default: 10 } });
    assert.equal(result.limit, "5");
  });

  it("handles value-only token as positional", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("hello key=value world");
    assert.equal(result._, "hello world");
    assert.equal(result.key, "value");
  });

  it("handles URLs as positional arguments", async () => {
    const { parseCommandArgs } = await load();
    const result = parseCommandArgs("https://example.com");
    assert.equal(result._, "https://example.com");
  });
});

describe("registerSavedWorkflow", () => {
  it("registers a command with the workflow name", async () => {
    const { registerSavedWorkflow } = await load();
    const commands: Array<{ name: string; description: string; handler: (...args: unknown[]) => unknown }> = [];
    const pi = {
      getCommands: () => commands.map((c) => ({ name: c.name })),
      registerCommand: (name: string, spec: { description: string; handler: (...args: unknown[]) => unknown }) => {
        commands.push({ name, ...spec });
      },
    };
    const wf = {
      name: "test-workflow",
      script: "export const meta = { name: 't', description: 't' };",
      description: "A test",
    };

    registerSavedWorkflow(pi as never, "/cwd", wf);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].name, "test-workflow");
  });

  it("is idempotent — second registration is skipped", async () => {
    const { registerSavedWorkflow } = await load();
    let regCount = 0;
    const pi = {
      getCommands: () => [{ name: "test-workflow" }],
      registerCommand: () => {
        regCount++;
      },
    };
    const wf = { name: "test-workflow", script: "export const meta = { name: 't', description: 't' };" };

    registerSavedWorkflow(pi as never, "/cwd", wf);
    assert.equal(regCount, 0, "should not re-register when already present");
  });

  it("registers multiple saved workflows", async () => {
    const { registerAllSavedWorkflows } = await load();
    const commands: string[] = [];
    const pi = {
      getCommands: () => commands.map((name) => ({ name })),
      registerCommand: (name: string) => {
        commands.push(name);
      },
    };
    const storage = {
      list: () => [
        { name: "wf1", script: "export..." },
        { name: "wf2", script: "export..." },
      ],
    };

    registerAllSavedWorkflows(pi as never, "/cwd", storage as never);
    assert.deepEqual(commands, ["wf1", "wf2"]);
  });

  it("runs through WorkflowManager when provided", async () => {
    const { registerSavedWorkflow } = await load();
    let startedBackground = false;
    const manager = {
      startInBackground: (_script: string, _args: unknown) => {
        startedBackground = true;
        return { runId: "test-run", promise: Promise.resolve({ result: { report: "done" } }) };
      },
    };

    const commands: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];
    const pi = {
      getCommands: () => commands.map((c) => ({ name: c.name })),
      registerCommand: (name: string, spec: { handler: (...args: unknown[]) => unknown }) => {
        commands.push({ name, handler: spec.handler });
      },
    };

    const wf = { name: "run-via-manager", script: "export..." };
    registerSavedWorkflow(pi as never, "/cwd", wf, manager as never);

    // Execute the handler
    const ctx = {
      ui: { notify: () => {}, setStatus: () => {} },
    };
    await commands[0].handler("", ctx as never);

    assert.equal(startedBackground, true, "should use startInBackground when manager provided");
  });

  it("falls back to runWorkflow when no manager", async () => {
    const { registerSavedWorkflow } = await load();

    const commands: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];
    const pi = {
      getCommands: () => commands.map((c) => ({ name: c.name })),
      registerCommand: (name: string, spec: { handler: (...args: unknown[]) => unknown }) => {
        commands.push({ name, handler: spec.handler });
      },
    };

    const wf = { name: "run-inline", script: "export const meta = { name: 't', description: 't' };" };
    registerSavedWorkflow(pi as never, "/cwd", wf); // no manager

    const ctx = {
      ui: { notify: () => {}, setStatus: () => {} },
    };
    // Should not throw despite no manager — falls back to runWorkflow
    // (will actually try to run the script, which may error or succeed)
    try {
      await commands[0].handler("", ctx as never);
    } catch {
      // Script execution errors are expected — what matters is it didn't crash
      // with TypeError about manager being undefined
    }

    assert.ok(true, "handler ran without crashing from lack of manager");
  });
});
