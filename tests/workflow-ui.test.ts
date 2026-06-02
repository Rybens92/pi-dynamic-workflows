import assert from "node:assert/strict";
import test from "node:test";
import { keyToAction, NavigatorModel, NavigatorState, renderNavigator } from "../src/workflow-ui.js";

/** Fake manager exposing one running run with two phases. */
function fakeManager() {
  const snapshot = {
    name: "audit",
    phases: ["Scan", "Report"],
    currentPhase: "Report",
    logs: [],
    agents: [
      {
        id: 1,
        label: "scan a",
        phase: "Scan",
        prompt: "scan the code",
        status: "done",
        resultPreview: "found 2",
        tokens: 100,
        model: "fast-llm/model",
      },
      {
        id: 2,
        label: "scan b",
        phase: "Scan",
        prompt: "scan more",
        status: "done",
        resultPreview: "found 1",
        tokens: 50,
        model: "fast-llm/model",
      },
      { id: 3, label: "write report", phase: "Report", prompt: "write it", status: "running", tokens: 0 },
    ],
    agentCount: 3,
    runningCount: 1,
    doneCount: 2,
    errorCount: 0,
    tokenUsage: { input: 100, output: 50, total: 150, cost: 0 },
  };
  return {
    listRuns: () => [
      {
        runId: "run-1",
        workflowName: "audit",
        status: "running",
        phases: ["Scan", "Report"],
        agents: snapshot.agents,
        logs: [],
        tokenUsage: snapshot.tokenUsage,
      },
    ],
    getRun: (id: string) => (id === "run-1" ? { runId: "run-1", status: "running", snapshot } : undefined),
  } as any;
}

function multiRunManager() {
  return {
    listRuns: () => [
      { runId: "r1", workflowName: "a-workflow", status: "running", phases: [], agents: [], logs: [] },
      { runId: "r2", workflowName: "b-workflow", status: "completed", phases: [], agents: [], logs: [] },
    ],
    getRun: () => undefined,
  } as any;
}

function persistedRunManager() {
  return {
    listRuns: () => [
      {
        runId: "r-old",
        workflowName: "old-run",
        status: "completed",
        phases: ["Build"],
        agents: [
          { id: 1, label: "builder", phase: "Build", status: "done", prompt: "build it", result: "ok" },
        ],
        logs: ["done"],
      },
    ],
    getRun: () => undefined,
  } as any;
}

test("NavigatorModel reads runs, phases, agents, and detail", () => {
  const model = new NavigatorModel(fakeManager());
  const runs = model.runs();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].done, 2);
  assert.equal(runs[0].total, 3);
  assert.equal(runs[0].tokens, 150);

  const phases = model.phases("run-1");
  assert.deepEqual(
    phases.map((p) => p.title),
    ["Scan", "Report"],
  );
  assert.equal(phases[0].total, 2);
  assert.equal(phases[0].tokens, 150);

  const agents = model.agents("run-1", "Scan");
  assert.deepEqual(
    agents.map((a) => a.label),
    ["scan a", "scan b"],
  );
  assert.equal(model.agentDetail("run-1", 3)?.label, "write report");
});

test("NavigatorModel handles unknown runId gracefully", () => {
  const model = new NavigatorModel(fakeManager());
  assert.deepEqual(model.phases("unknown"), []);
  assert.deepEqual(model.agents("unknown", "Scan"), []);
  assert.equal(model.agentDetail("unknown", 1), undefined);
  assert.equal(model.runName("unknown"), "unknown");
  assert.equal(model.runStatus("unknown"), "unknown");
});

test("NavigatorModel works with multiple runs", () => {
  const model = new NavigatorModel(multiRunManager());
  const runs = model.runs();
  assert.equal(runs.length, 2);
  assert.equal(runs[0].runId, "r1");
  assert.equal(runs[1].runId, "r2");
});

test("NavigatorModel reads from persisted runs when no live snapshot", () => {
  const model = new NavigatorModel(persistedRunManager());
  const runs = model.runs();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].name, "old-run");
  assert.equal(runs[0].done, 1);
  assert.equal(runs[0].total, 1);

  const phases = model.phases("r-old");
  assert.equal(phases.length, 1);
  assert.equal(phases[0].title, "Build");

  const agents = model.agents("r-old", "Build");
  assert.equal(agents.length, 1);
  assert.equal(agents[0].label, "builder");
});

test("NavigatorState drills runs -> phases -> agents -> detail and back", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  assert.equal(state.kind, "runs");

  assert.ok(state.drill(model));
  assert.equal(state.kind, "phases");
  assert.equal(state.runId, "run-1");

  assert.ok(state.drill(model));
  assert.equal(state.kind, "agents");
  assert.equal(state.phase, "Scan");

  assert.ok(state.drill(model));
  assert.equal(state.kind, "detail");
  assert.equal(state.agentId, 1);

  assert.ok(state.back());
  assert.equal(state.kind, "agents");
  assert.ok(state.back());
  assert.ok(state.back());
  assert.equal(state.kind, "runs");
  assert.equal(state.back(), false, "back at top returns false (caller closes)");
});

test("NavigatorState cursor wraps and detail scroll clamps at 0", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  state.move(-1, 1);
  assert.equal(state.cursor, 0);

  state.drill(model);
  state.drill(model);
  state.move(1, 2);
  assert.equal(state.cursor, 1);
  state.move(1, 2);
  assert.equal(state.cursor, 0);

  state.drill(model);
  state.move(-1, 0);
  assert.equal(state.scroll, 0);
  state.move(1, 0);
  assert.equal(state.scroll, 1);
});

test("NavigatorState drill returns false when nothing to drill into", () => {
  const model = new NavigatorModel({
    listRuns: () => [],
    getRun: () => undefined,
  } as any);
  const state = new NavigatorState();
  const drilled = state.drill(model);
  assert.equal(drilled, false);
});

test("NavigatorState activeRunId returns run at cursor on runs view", () => {
  const model = new NavigatorModel(multiRunManager());
  const state = new NavigatorState();
  assert.equal(state.activeRunId(model), "r1");
  state.move(1, 2);
  assert.equal(state.activeRunId(model), "r2");
});

test("NavigatorState activeRunId returns undefined with no runs", () => {
  const model = new NavigatorModel({
    listRuns: () => [],
    getRun: () => undefined,
  } as any);
  const state = new NavigatorState();
  assert.equal(state.activeRunId(model), undefined);
});

test("NavigatorState clamp handles zero items", () => {
  const state = new NavigatorState();
  state.clamp(0);
  assert.equal(state.cursor, 0);
});

test("keyToAction maps keys per view", () => {
  assert.deepEqual(keyToAction("up", "runs"), { type: "move", delta: -1 });
  assert.deepEqual(keyToAction("j", "agents"), { type: "move", delta: 1 });
  assert.deepEqual(keyToAction("enter", "runs"), { type: "drill" });
  assert.deepEqual(keyToAction("enter", "detail"), { type: "none" });
  assert.deepEqual(keyToAction("right", "runs"), { type: "drill" });
  assert.deepEqual(keyToAction("escape", "phases"), { type: "back" });
  assert.deepEqual(keyToAction("left", "agents"), { type: "back" });
  assert.deepEqual(keyToAction("q", "runs"), { type: "close" });
  assert.deepEqual(keyToAction("p", "runs"), { type: "pause" });
  assert.deepEqual(keyToAction("x", "agents"), { type: "stop" });
  assert.deepEqual(keyToAction("s", "runs"), { type: "save" });
  assert.deepEqual(keyToAction("r", "runs"), { type: "restart" });
  assert.deepEqual(keyToAction("k", "runs"), { type: "move", delta: -1 });
  assert.deepEqual(keyToAction("unknown", "runs"), { type: "none" });
  assert.deepEqual(keyToAction(undefined, "runs"), { type: "none" });
  assert.deepEqual(keyToAction("return", "agents"), { type: "drill" });
});

test("renderNavigator shows runs view with selected row and footer hint", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  assert.match(text, /Workflows/);
  assert.match(text, /❯ ◆ audit/);
  assert.match(text, /enter open/); // footer hint
});

test("renderNavigator shows empty hint when no runs", () => {
  const model = new NavigatorModel({
    listRuns: () => [],
    getRun: () => undefined,
  } as any);
  const state = new NavigatorState();
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  assert.match(text, /No runs yet/);
});

test("renderNavigator shows phases view", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  state.drill(model);
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  assert.match(text, /audit/);
  assert.match(text, /running/);
  assert.match(text, /Scan/);
  assert.match(text, /Report/);
});

test("renderNavigator shows agents view", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  state.drill(model);
  state.drill(model);
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  assert.match(text, /audit › Scan/);
  assert.match(text, /❯ ✓ scan a/);
  assert.match(text, /scan b/);
  assert.match(text, /enter open/);
});

test("renderNavigator shows agent detail view", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  state.drill(model);
  state.drill(model);
  state.drill(model);
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  assert.match(text, /Prompt:/);
  assert.match(text, /scan the code/);
  assert.match(text, /Result:/);
  assert.match(text, /found 2/);
  assert.match(text, /Status:/);
  assert.match(text, /Model:/);
  assert.match(text, /model/); // shortModel strips provider prefix → shows just "model"
  assert.match(text, /j\/k scroll/); // detail view footer
});

test("renderNavigator shows model info in agent rows", () => {
  const model = new NavigatorModel(fakeManager());
  const state = new NavigatorState();
  state.drill(model);
  state.drill(model);
  const lines = renderNavigator(state, model, 80);
  const text = lines.join("\n");
  // shortModel() strips the provider prefix so "fast-llm/model" displays as just "model"
  assert.match(text, /model/);
});

test("renderNavigator shows correct footer hint per view", () => {
  const model = new NavigatorModel(fakeManager());
  
  // Runs view footer
  const runsLines = renderNavigator(new NavigatorState(), model, 80);
  assert.match(runsLines.join("\n"), /enter open.*esc back/);
  
  // Detail view footer
  const state = new NavigatorState();
  state.drill(model);
  state.drill(model);
  state.drill(model);
  const detailLines = renderNavigator(state, model, 80);
  assert.match(detailLines.join("\n"), /j\/k scroll/);
});
