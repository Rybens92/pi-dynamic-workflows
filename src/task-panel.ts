/**
 * Background-run UX, mirroring Claude Code:
 *  - A live task panel below the input lists in-progress runs while you keep working.
 *    It is informational; run /workflows to open the full navigator.
 *  - When a background run finishes, its result is delivered back into the
 *    conversation so the paused task continues with the outcome.
 */

import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ManagedRun, WorkflowManager } from "./workflow-manager.js";
import type { WorkflowStorage } from "./workflow-saved.js";

const RUN_EVENTS = ["agentStart", "agentEnd", "phase", "log", "complete", "error", "stopped", "paused", "resumed"];

export interface TaskPanelOptions {
  storage?: WorkflowStorage;
  cwd?: string;
}

export function deliverText(run: ManagedRun): string {
  const result = run.result?.result as Record<string, unknown> | undefined;
  // Try to find a clean text summary in order of preference:
  // 1. verdict (most common for orchestrate/deep-research workflows)
  // 2. report (custom report property)
  // 3. summary (short summary)
  // 4. string result directly
  // 5. fallback: first 400 chars of JSON
  const summary =
    result && typeof result.verdict === "string" && result.verdict.trim()
      ? result.verdict
      : result && typeof result.report === "string" && result.report.trim()
        ? result.report
        : result && typeof result.summary === "string" && result.summary.trim()
          ? result.summary
          : typeof result === "string"
            ? result
            : result != null ? JSON.stringify(result, null, 2).slice(0, 400) + (JSON.stringify(result, null, 2).length > 400 ? "\n…(truncated)" : "") : "null";
  const tokens = run.result?.tokenUsage ? ` · ${run.result.tokenUsage.total.toLocaleString()} tokens` : "";
  const agents = run.result?.agentCount ?? run.snapshot.agentCount;
  const duration = run.result?.durationMs ? ` · ${(run.result.durationMs / 1000).toFixed(1)}s` : "";
  return [
    `✓ Background workflow "${run.snapshot.name}" finished (${agents} agents${tokens}${duration}).`,
    "",
    summary,
  ].join("\n");
}

/**
 * When a background run finishes (or fails), deliver its result back into the
 * conversation AND continue the turn so the assistant can act on it — without
 * blocking the user meanwhile:
 *
 *  - `triggerTurn: true` starts a fresh turn when the agent is idle, feeding the
 *    result to the model so the paused conversation continues.
 *  - `deliverAs: "followUp"` means that if the user is busy in another turn, the
 *    result is queued and picked up after that turn finishes — never interrupting.
 *
 * Set up once per extension; idempotent via an internal guard.
 */
export function installResultDelivery(pi: ExtensionAPI, manager: WorkflowManager): void {
  // Mutable holder on manager so shared across re-calls (e.g. session_start after /reload).
  const m = manager as unknown as { __deliveryInstalled?: boolean; __holder?: { pi: ExtensionAPI } };
  if (m.__deliveryInstalled) {
    // Refresh pi reference only — listeners stay registered.
    if (m.__holder) m.__holder.pi = pi;
    return;
  }
  m.__deliveryInstalled = true;
  m.__holder = { pi };

  const deliver = (content: string) => {
    try {
      void m.__holder!.pi.sendMessage(
        { customType: "workflow-result", content, display: true },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    } catch {
      // Stale ctx after reload — result still visible via /workflows.
    }
  };

  manager.on("complete", ({ runId }: { runId: string }) => {
    const run = manager.getRun(runId);
    // Only background/resumed runs are delivered: a foreground (sync) run already
    // returns its result inline as the tool result, so re-delivering would dup it.
    if (run?.background) deliver(deliverText(run));
  });
  manager.on("error", ({ runId, error }: { runId: string; error?: { message?: string } }) => {
    if (!manager.getRun(runId)?.background) return;
    deliver(`✗ Background workflow ${runId} failed: ${error?.message ?? "unknown error"}`);
  });
}

function renderPanel(manager: WorkflowManager, theme: Theme): string[] {
  const active = manager.listRuns().filter((r) => r.status === "running" || r.status === "paused");
  if (!active.length) return [];
  const rows = active.map((r) => {
    const live = manager.getRun(r.runId);
    const agents = live?.snapshot.agents ?? r.agents;
    const done = agents.filter((a) => a.status === "done").length;
    const icon = r.status === "paused" ? "⏸" : "◆";
    const phase = live?.snapshot.currentPhase ? ` · ${live.snapshot.currentPhase}` : "";
    return `  ${icon} ${r.workflowName}  ${done}/${agents.length} agents${phase}`;
  });
  const hint = theme.fg("dim", "  run /workflows to open");
  return [theme.bold(`Workflows running (${active.length}):`), ...rows, hint];
}

/**
 * Install the live "workflows running" panel below the editor. Re-rendered on
 * every manager event. Informational only — the user opens the navigator with
 * /workflows. (`_pi`/`_opts` are kept for signature stability.)
 */
export function installTaskPanel(
  _pi: ExtensionAPI,
  manager: WorkflowManager,
  ui: ExtensionUIContext,
  _opts: TaskPanelOptions = {},
): void {
  ui.setWidget(
    "workflow-tasks",
    (tui: TUI, theme: Theme) => {
      const onEvent = () => tui.requestRender();
      for (const ev of RUN_EVENTS) manager.on(ev, onEvent);
      // Purely informational: it lists running runs and re-renders on events. To
      // open the navigator, the user runs /workflows (the panel takes no input).
      const comp: Component & { dispose?(): void } = {
        render: () => renderPanel(manager, theme),
        invalidate: () => {},
        dispose: () => {
          for (const ev of RUN_EVENTS) manager.off(ev, onEvent);
        },
      };
      return comp;
    },
    { placement: "belowEditor" },
  );
}
