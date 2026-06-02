/**
 * `/workflows-models` command handler.
 *
 * Uses Pi's built-in `ctx.ui.select()`, `ctx.ui.confirm()`, and `ctx.ui.notify()`
 * to let users view and manage model tier configuration for workflows.
 *
 * Model selection draws from the same `listAvailableModelSpecs()` that powers
 * Pi's `/model` command, so users see exactly the same models.
 *
 * Each tier holds exactly one model spec string.
 * When editing a tier, a single-select picker is used (like Pi's `/model`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { listAvailableModelSpecs } from "./agent.js";
import {
  buildDefaultTierConfig,
  ensureModelTierConfig,
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

      // ensureModelTierConfig handles "fresh install" — creates default config if none exists
      let config = ensureModelTierConfig();
      let dirty = false;

      const ensureFresh = (cfg: typeof config) => {
        config = cfg;
        dirty = true;
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tiers = sortedTierNames(config);
        const menuOptions: string[] = [];

        menuOptions.push("─".repeat(30));
        for (const name of tiers) {
          const model = config.tiers[name];
          menuOptions.push(`${name} tier → ${model}`);
        }
        menuOptions.push("─".repeat(30));

        menuOptions.push("Reset to defaults");
        menuOptions.push(dirty ? "Save and exit" : "Exit");

        const choice = await ctx.ui.select("Model tier configuration", menuOptions);

        if (!choice) break;

        // Handle "<tier> → [model]" selections
        for (const name of tiers) {
          if (choice.startsWith(`${name} tier →`)) {
            const updatedTiers = await editSingleTier(ctx, config.tiers, name);
            if (updatedTiers !== null) {
              ensureFresh({ ...config, tiers: updatedTiers });
            }
            break;
          }
        }

        if (choice === "Reset to defaults") {
          const confirmed = await ctx.ui.confirm(
            "Reset model tiers",
            "This will replace current configuration with auto-classified defaults. Continue?",
          );
          if (confirmed) {
            ensureFresh(buildDefaultTierConfig());
            ctx.ui.notify("Tiers reset to defaults. Use 'Save and exit' to persist.", "info");
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
 * Interactive editor for a single tier — single-select model picker.
 *
 * Shows ALL available models, marks the currently selected one with "→".
 * This is the same interaction pattern as Pi's `/model` command.
 *
 * Includes "Clear" (remove the model from this tier) and "Done" (return).
 *
 * Returns the updated tiers object, or null if nothing changed.
 */
export async function editSingleTier(
  ctx: {
    ui: {
      select: (title: string, options: string[]) => Promise<string | undefined>;
      notify: (msg: string, type?: "error" | "info" | "warning") => void;
    };
  },
  tiers: Record<string, string>,
  tierName: string,
): Promise<Record<string, string> | null> {
  const available = listAvailableModelSpecs();
  const current = tiers[tierName];

  const currentStr = current ?? "(none)";

  // Build a single-select model list: currently selected gets "→" prefix
  const modelOptions = available.map((m) => {
    return m === current ? `→ ${m}` : `  ${m}`;
  });

  const options: string[] = [
    `Current: ${currentStr}`,
    "─".repeat(30),
    ...modelOptions,
    "─".repeat(30),
    "Clear",
    "Done",
  ];

  const choice = await ctx.ui.select(`Pick a model for "${tierName}" tier`, options);

  if (!choice || choice === "Done") return null;

  if (choice === "Clear") {
    if (current === undefined) {
      ctx.ui.notify(`"${tierName}" tier already has no model assigned.`, "info");
      return null;
    }
    // Build a new tiers object without this key to "clear" it
    const newTiers: Record<string, string> = {};
    for (const [k, v] of Object.entries(tiers)) {
      if (k !== tierName) newTiers[k] = v;
    }
    ctx.ui.notify(`"${tierName}" tier cleared (no model assigned).`, "info");
    return newTiers;
  }

  // Extract model name from "→ provider/model" or "  provider/model"
  const modelMatch = choice.match(/^(?:→ | {2})(.+)$/);
  if (!modelMatch) return null;

  const modelSpec = modelMatch[1];
  if (modelSpec === current) return null; // no change

  ctx.ui.notify(`"${tierName}" tier → ${modelSpec}`, "info");
  return { ...tiers, [tierName]: modelSpec };
}
