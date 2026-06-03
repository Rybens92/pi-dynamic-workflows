import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseWorkflow, suggestWorkflowScript } from "../src/auto-workflow.js";

test("shouldUseWorkflow returns disabled when enabled=false", () => {
  const result = shouldUseWorkflow("any task", { enabled: false });
  assert.equal(result.useWorkflow, false);
  assert.equal(result.confidence, 0);
});

test("shouldUseWorkflow matches explicit trigger keywords", () => {
  const result = shouldUseWorkflow("workflow to process all files");
  assert.equal(result.useWorkflow, true);
  assert.ok(result.confidence > 0.5, "result.confidence should be greater than 0.5");
});

test("shouldUseWorkflow matches workflows keyword", () => {
  const result = shouldUseWorkflow("use workflows mode");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow matches parallel keyword", () => {
  const result = shouldUseWorkflow("run parallel tasks");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow matches audit keyword", () => {
  const result = shouldUseWorkflow("audit the codebase");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow matches migrate keyword", () => {
  const result = shouldUseWorkflow("migrate all files");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow matches research keyword", () => {
  const result = shouldUseWorkflow("research this topic");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on high complexity with many subtask indicators", () => {
  const result = shouldUseWorkflow(
    "first do this, then do that, finally wrap up, analyze all files, next verify each component, also check the results",
  );
  assert.equal(result.useWorkflow, true);
  assert.ok(result.confidence > 0, "result.confidence should be greater than 0");
});

test("shouldUseWorkflow returns false for simple tasks", () => {
  const result = shouldUseWorkflow("fix typo in file");
  assert.equal(result.useWorkflow, false);
});

test("shouldUseWorkflow triggers on bulk keyword", () => {
  const result = shouldUseWorkflow("bulk update components");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on batch keyword", () => {
  const result = shouldUseWorkflow("batch process everything");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on 'analyze all' pattern", () => {
  const result = shouldUseWorkflow("analyze all modules");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on 'check every' pattern", () => {
  const result = shouldUseWorkflow("check every endpoint");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on 'sweep' keyword", () => {
  const result = shouldUseWorkflow("sweep the codebase");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow returns reason string", () => {
  const result = shouldUseWorkflow("workflow task");
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0, "result.reason should not be empty");
});

test("shouldUseWorkflow high confidence with multiple keywords", () => {
  const result = shouldUseWorkflow("workflow to audit and migrate all files in parallel");
  assert.ok(result.confidence > 0.7, "result.confidence should be greater than 0.7");
});

test("shouldUseWorkflow can be configured with custom keywords", () => {
  const result = shouldUseWorkflow("special command", {
    enabled: true,
    triggerKeywords: ["special"],
    minSubtasks: 2,
    complexityThreshold: 5,
  });
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow does not trigger on numeric item count alone (need more complexity)", () => {
  const result = shouldUseWorkflow("check 50 files for issues");
  // Single numeric indicator alone (weight 2) doesn't reach threshold 7
  assert.equal(result.useWorkflow, false);
  assert.ok(result.confidence <= 0.3, "result.confidence should be at most 0.3");
});

test("shouldUseWorkflow triggers on 'across' with multiple indicators", () => {
  // Combined indicators: analyze(1) + across(1.5) + entire(2) = 4.5 < 7
  // But add 'then' + 'first' for subtask estimation
  const result = shouldUseWorkflow("analyze across the entire project, first check, then verify");
  assert.equal(result.useWorkflow, true);
});

test("shouldUseWorkflow triggers on 'refactor' with multiple indicators", () => {
  const result = shouldUseWorkflow("refactor all components, first migrate then verify");
  assert.equal(result.useWorkflow, true);
});

test("suggestWorkflowScript returns a valid parseable script", () => {
  const script = suggestWorkflowScript("analyze all source files");
  assert.ok(script.startsWith("export const meta = {"), "should start with export const meta = {");
  assert.ok(script.includes("name: 'auto_generated'"), "should contain name: 'auto_generated");
  assert.ok(script.includes("description: 'analyze all source files'"), "should contain description: 'analyze all source files");
  assert.ok(script.includes("agent("), "should contain agent(");
  assert.ok(script.includes("phase("), "should contain phase(");
  assert.ok(script.includes("parallel("), "should contain parallel(");
  assert.ok(script.includes("return {"), "should contain return {");
});

test("suggestWorkflowScript includes phases: Analyze, Execute, Verify", () => {
  const script = suggestWorkflowScript("test");
  assert.ok(script.includes("Analyze"), "should contain Analyze");
  assert.ok(script.includes("Execute"), "should contain Execute");
  assert.ok(script.includes("Verify"), "should contain Verify");
});

test("suggestWorkflowScript escapes single quotes in description", () => {
  const script = suggestWorkflowScript("it's a test");
  assert.ok(!script.includes("it's"), "should not contain it's");  // should be escaped
  assert.ok(script.includes("it\\'s"), "should contain it\\'s");  // escaped version
});

test("suggestWorkflowScript truncates long descriptions", () => {
  const long = "x".repeat(200);
  const script = suggestWorkflowScript(long);
  // Description should be <= 100 chars
  const descMatch = script.match(/description: '([^']+)'/);
  assert.ok(descMatch, "should match description pattern");
  assert.ok(descMatch[1].length <= 100, "length should be at most 100");
});

test("suggestWorkflowScript always returns a string", () => {
  const result = suggestWorkflowScript("");
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0, "result should not be empty");
});
