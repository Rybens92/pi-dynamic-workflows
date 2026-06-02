import assert from "node:assert/strict";
import test from "node:test";
import { backgroundStartedText } from "../src/workflow-tool.js";
import { createWorkflowTool } from "../src/workflow-tool.js";
import { parseWorkflowScript } from "../src/workflow.js";

// ─── backgroundStartedText ─────────────────────────────────────────────────────

test("backgroundStartedText tells the user it auto-continues and they can wait", () => {
  const text = backgroundStartedText("audit", "abc-123");
  assert.match(text, /audit/);
  assert.match(text, /abc-123/);
  assert.match(text, /wait here/i);
  assert.match(text, /continues automatically|resume the conversation/i);
  assert.match(text, /other things/i);
  assert.match(text, /\/workflows status abc-123/);
});

// ─── createWorkflowTool ────────────────────────────────────────────────────────

test("createWorkflowTool has correct name and label", () => {
  const tool = createWorkflowTool();
  assert.equal(tool.name, "workflow");
  assert.equal(tool.label, "Workflow");
});

test("createWorkflowTool has description", () => {
  const tool = createWorkflowTool();
  assert.ok(tool.description);
  assert.ok(tool.description.length > 20);
});

test("createWorkflowTool has parameters defined", () => {
  const tool = createWorkflowTool();
  assert.ok(tool.parameters, "should have parameters schema");
});

test("createWorkflowTool has execute function", () => {
  const tool = createWorkflowTool();
  assert.equal(typeof tool.execute, "function");
});

test("createWorkflowTool has renderCall and renderResult", () => {
  const tool = createWorkflowTool();
  assert.equal(typeof tool.renderCall, "function");
  assert.equal(typeof tool.renderResult, "function");
});

test("createWorkflowTool has promptSnippet", () => {
  const tool = createWorkflowTool();
  assert.ok(tool.promptSnippet);
  assert.ok(tool.promptSnippet.includes("workflow"));
});

test("createWorkflowTool has promptGuidelines array", () => {
  const tool = createWorkflowTool();
  assert.ok(Array.isArray(tool.promptGuidelines));
  assert.ok(tool.promptGuidelines.length > 5, "should have several guidelines");
});

test("createWorkflowTool promptGuidelines mention model routing", () => {
  const tool = createWorkflowTool();
  const all = tool.promptGuidelines.join(" ");
  assert.ok(all.includes("model") || all.includes("model"));
});

test("createWorkflowTool invalid args throws descriptive error", () => {
  const tool = createWorkflowTool();
  // We can test prepareArguments through the tool definition
  if (tool.prepareArguments) {
    assert.throws(
      () => (tool.prepareArguments as Function)({ script: 123 }),
      /script.*string/,
    );
    assert.throws(
      () => (tool.prepareArguments as Function)("not-an-object"),
      /object argument/,
    );
  }
});

test("createWorkflowTool with custom cwd creates tool", () => {
  const tool = createWorkflowTool({ cwd: "/tmp" });
  assert.equal(tool.name, "workflow");
});

// ─── prepareArguments / normalizeWorkflowScript ─────────────────────────────────

test("createWorkflowTool prepareArguments strips markdown fences from script", () => {
  const tool = createWorkflowTool();
  if (tool.prepareArguments) {
    const result = (tool.prepareArguments as Function)({
      script: "```js\nconst x = 1\n```",
    });
    assert.equal(result.script, "const x = 1");
  }
});

test("createWorkflowTool prepareArguments strips javascript fences", () => {
  const tool = createWorkflowTool();
  if (tool.prepareArguments) {
    const result = (tool.prepareArguments as Function)({
      script: "```\nexport const meta = { name: 't', description: 't' }\n```",
    });
    assert.equal(result.script, "export const meta = { name: 't', description: 't' }");
  }
});

test("createWorkflowTool prepareArguments passes through args", () => {
  const tool = createWorkflowTool();
  if (tool.prepareArguments) {
    const result = (tool.prepareArguments as Function)({
      script: "export const meta = { name: 't', description: 't' }",
      args: { question: "test" },
      maxAgents: 5,
    });
    assert.equal(result.script, "export const meta = { name: 't', description: 't' }");
    assert.deepEqual(result.args, { question: "test" });
    assert.equal(result.maxAgents, 5);
  }
});
