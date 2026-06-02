/**
 * `/workflows-models` command handler.
 *
 * Uses Pi's built-in `ctx.ui.select()`, `ctx.ui.confirm()`, and `ctx.ui.notify()`
 * to let users view and manage model tier configuration for workflows.
 *
 * Model selection draws from the same `listAvailableModelSpecs()` that powers
 * Pi's `/model` command, so users see exactly the same models.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { listAvailableModelSpecs } from "./agent.js";
import {
  buildDefaultTierConfig,
  classifyModelSpec,
  formatTierConfig,
  loadModelTierConfig,
  saveModelTierConfig,
  sortedTierNames,
} from "./model-tier-config.js";

/**
 * Register the `/workflows-models` command with Pi.
 */
export function registerWorkflowModelsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("workflows-models", {
    description: "View and edit model tiers used by workflows (small/medium/big)",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      // Load current config or build a default one the user can save
      let config = loadModelTierConfig() ?? buildDefaultTierConfig();
      let dirty = false;

      const ensureFresh = (cfg: typeof config) => {
        config = cfg;
        dirty = true;
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tiers = sortedTierNames(config);
        const menuOptions: string[] = [];

        for (const name of tiers) {
          const models = config.tiers[name];
          const summary = models.length > 0 ? models.join(", ") : "(empty)";
          menuOptions.push(`Set ${name} → ${summary}`);
        }

        menuOptions.push("─".repeat(30));
        menuOptions.push("Reset to defaults");
        menuOptions.push(dirty ? "Save and exit" : "Exit");

        const choice = await ctx.ui.select(
          "Workflows — Model Tiers",
          ["Current configuration", formatTierConfig(config), "", ...menuOptions],
        );

        if (!choice) break;

        // Handle "Set <tier> → ..." selection
        for (const name of tiers) {
          if (choice.startsWith(`Set ${name}`)) {
            const updatedTiers = await editTier(ctx, config.tiers, name);
            if (updatedTiers !== null) {
              ensureFresh({ ...config, tiers: updatedTiers });
            }
            break;
          }
        }

        if (choice === "Reset to defaults") {
          const confirmed = await ctx.ui.confirm(
            "Reset model tiers",
            "This will auto-classify your available models. Continue?",
          );
          if (confirmed) {
            ensureFresh(buildDefaultTierConfig());
            ctx.ui.notify(
              "Tiers reset to defaults. Use 'Save and exit' to persist.",
              "info",
            );
          }
        }

        if (choice === "Save and exit" || choice === "Exit") {
          if (choice === "Save and exit") {
            saveModelTierConfig(config);
            ctx.ui.notify("Model tiers saved.", "info");
          }
          break;
        }
      }
    },
  });
}

/**
 * Interactive editor for a single tier's model list.
 * Loops internally so the user can add/remove multiple models before
 * returning to the parent menu. Returns updated tiers object or null.
 */
async function editTier(
  ctx: {
    ui: {
      select: (
        title: string,
        options: string[],
      ) => Promise<string | undefined>;
      notify: (msg: string, type?: "error" | "info" | "warning") => void;
      confirm: (
        title: string,
        msg: string,
      ) => Promise<boolean>;
    };
  },
  tiers: Record<string, string[]>,
  tierName: string,
): Promise<Record<string, string[]> | null> {
  const available = listAvailableModelSpecs();
  let current = [...(tiers[tierName] ?? [])];
  let showAll = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const currentStr = current.length > 0 ? current.join(", ") : "(empty)";

    // Filter models by tier classification so each tier editor only shows
    // models appropriate for that tier. User can toggle to see all models.
    const visible = showAll
      ? available
      : available.filter((m) => classifyModelSpec(m) === tierName);

    const modelOptions = visible.map((m) => {
      const selected = current.includes(m);
      return `${selected ? "✓" : "○"} ${m}`;
    });

    const viewLabel = showAll
      ? "Showing all models"
      : `Showing ${tierName} models only`;

    const options: string[] = [
      `Current: ${currentStr}`,
      viewLabel,
      "─".repeat(30),
      ...modelOptions,
      "─".repeat(30),
    ];

    // Toggle view mode
    if (showAll) {
      options.push(`Show only ${tierName} models`);
    } else {
      options.push("Show all models");
    }

    if (current.length > 0) {
      options.push("Clear all");
    }
    options.push("Done");

    const choice = await ctx.ui.select(
      `Toggle models for "${tierName}" — click to add/remove`,
      options,
    );

    if (!choice || choice === "Done") break;

    if (choice === "Clear all") {
      const confirmed = await ctx.ui.confirm(
        "Clear tier",
        `Remove all models from "${tierName}" tier?`,
      );
      if (confirmed) {
        current = [];
        ctx.ui.notify(`"${tierName}" tier cleared.`, "info");
      }
      continue;
    }

    if (choice === "Show all models") {
      showAll = true;
      continue;
    }

    if (choice === `Show only ${tierName} models`) {
      showAll = false;
      continue;
    }

    // Toggle model selection — extract model name from "✓ provider/model" or "○ provider/model"
    const modelMatch = choice.match(/^[✓○] (.+)$/);
    if (!modelMatch) continue;

    const modelSpec = modelMatch[1];
    const idx = current.indexOf(modelSpec);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(modelSpec);
    }
  }

  // Check if anything changed
  const prev = tiers[tierName] ?? [];
  if (current.length === prev.length && current.every((m, i) => m === prev[i])) {
    return null; // no changes
  }

  return { ...tiers, [tierName]: current };
}
