import assert from "node:assert/strict";
import test from "node:test";
import { listAvailableModelSpecs, WorkflowAgent } from "../src/agent.js";

test("listAvailableModelSpecs returns an array (empty when no auth configured)", () => {
  const result = listAvailableModelSpecs();
  assert.ok(Array.isArray(result), "should always return an array");
  // On CI or fresh installs there may be no models configured
  // The important thing is it doesn't throw
});

test("listAvailableModelSpecs entries have provider/model format when non-empty", () => {
  const result = listAvailableModelSpecs();
  for (const spec of result) {
    assert.ok(spec.includes("/"), `model spec "${spec}" should use provider/id format`);
    const [provider, id] = spec.split("/");
    assert.ok(provider.length > 0, "provider should not be empty");
    assert.ok(id.length > 0, "model id should not be empty");
  }
});

test("WorkflowAgent constructor accepts options", () => {
  const agent = new WorkflowAgent({ cwd: "/tmp" });
  assert.ok(agent instanceof WorkflowAgent);
});

test("WorkflowAgent constructor works without options", () => {
  const agent = new WorkflowAgent();
  assert.ok(agent instanceof WorkflowAgent);
});

test("WorkflowAgent with custom instructions", () => {
  const agent = new WorkflowAgent({
    cwd: "/tmp",
    instructions: "custom instruction",
  });
  assert.ok(agent instanceof WorkflowAgent);
});

test("WorkflowAgent constructor handles all option combinations gracefully", () => {
  const agent = new WorkflowAgent({
    cwd: "/tmp",
    tools: [],
    session: {},
    instructions: "test",
  });
  assert.ok(agent instanceof WorkflowAgent);
});
