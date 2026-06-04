import assert from "node:assert/strict";
import test from "node:test";
import { registerBuiltinWorkflows } from "../src/builtin-commands.js";

test("registerBuiltinWorkflows registers deep-research and adversarial-review commands", () => {
  const commands: Array<{ name: string; description: string; handler: (...args: unknown[]) => unknown }> = [];
  const pi: any = {
    getCommands: () => commands.map((c) => ({ name: c.name })),
    registerCommand: (name: string, spec: { description: string; handler: (...args: unknown[]) => unknown }) => {
      commands.push({ name, ...spec });
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });
  assert.equal(commands.length, 2);
  const names = commands.map((c) => c.name).sort();
  assert.deepEqual(names, ["adversarial-review", "deep-research"]);
});

test("registerBuiltinWorkflows is idempotent — skips already registered commands", () => {
  const commands: Array<{ name: string }> = [{ name: "deep-research" }, { name: "adversarial-review" }];
  let registerCount = 0;
  const pi: any = {
    getCommands: () => commands,
    registerCommand: () => {
      registerCount++;
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });
  assert.equal(registerCount, 0, "should not re-register when already present");
});

test("registerBuiltinWorkflows registers only missing commands", () => {
  const commands: Array<{ name: string }> = [{ name: "deep-research" }];
  const registered: string[] = [];
  const pi: any = {
    getCommands: () => commands,
    registerCommand: (name: string) => {
      registered.push(name);
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });
  assert.deepEqual(registered, ["adversarial-review"], "should only register the missing command");
});

test("registerBuiltinWorkflows deep-research handler validates empty args (returns early)", async () => {
  const commands: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];
  const pi: any = {
    getCommands: () => commands.map((c) => ({ name: c.name })),
    registerCommand: (name: string, spec: { handler: (...args: unknown[]) => unknown }) => {
      commands.push({ name, handler: spec.handler });
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });
  const deepResearchHandler = commands.find((c) => c.name === "deep-research")?.handler;
  assert.ok(deepResearchHandler, "deep-research handler should exist");

  // Calling with empty args should warn and return early (before running any workflow)
  const notified: Array<{ message: string; type?: string }> = [];
  const ctx: any = {
    ui: { notify: (msg: string, type?: string) => notified.push({ message: msg, type }), setStatus: () => {} },
  };

  await deepResearchHandler("", ctx);
  assert.equal(notified.length, 1, "should notify with warning");
  assert.equal(notified[0].type, "warning", "should be a warning");
  assert.ok(notified[0].message.includes("Usage"), "should tell the user how to use it");
});

test("registerBuiltinWorkflows adversarial-review handler validates empty args (returns early)", async () => {
  const commands: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];
  const pi: any = {
    getCommands: () => commands.map((c) => ({ name: c.name })),
    registerCommand: (name: string, spec: { handler: (...args: unknown[]) => unknown }) => {
      commands.push({ name, handler: spec.handler });
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });
  const advHandler = commands.find((c) => c.name === "adversarial-review")?.handler;
  assert.ok(advHandler, "adversarial-review handler should exist");

  // Calling with empty args should warn and return early
  const notified: Array<{ message: string; type?: string }> = [];
  const ctx: any = {
    ui: { notify: (msg: string, type?: string) => notified.push({ message: msg, type }), setStatus: () => {} },
  };

  await advHandler("", ctx);
  assert.equal(notified.length, 1, "should notify with warning");
  assert.equal(notified[0].type, "warning", "should be a warning");
  assert.ok(notified[0].message.includes("Usage"), "should tell the user how to use it");
});

test("registerBuiltinWorkflows creates handlers with expected structure", () => {
  const commands: Array<{ name: string; description: string; handler: (...args: unknown[]) => unknown }> = [];
  const pi: any = {
    getCommands: () => commands.map((c) => ({ name: c.name })),
    registerCommand: (name: string, spec: { description: string; handler: (...args: unknown[]) => unknown }) => {
      commands.push({ name, ...spec });
    },
  };

  registerBuiltinWorkflows(pi, { cwd: "/tmp" });

  const deepResearchCmd = commands.find((c) => c.name === "deep-research");
  assert.ok(deepResearchCmd, "deep-research should be registered");
  assert.ok(deepResearchCmd.description.includes("Research"), "should have research description");
  assert.equal(typeof deepResearchCmd.handler, "function");

  const advReviewCmd = commands.find((c) => c.name === "adversarial-review");
  assert.ok(advReviewCmd, "adversarial-review should be registered");
  assert.ok(
    advReviewCmd.description.includes("Investigate") || advReviewCmd.description.includes("Review"),
    "should contain Investigate",
  );
  assert.equal(typeof advReviewCmd.handler, "function");
});
