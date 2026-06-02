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
 * Shows ALL available models as-is (no prefixes — Pi's native
 * `ctx.ui.select()` already renders a focus indicator).
 * The currently selected model is shown in the dialog title.
 * User picks one model or selects "Done" to return.
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

  // Show ALL available models with no prefix — Pi's native select
  // handles focus highlighting. The current selection is in the title.
  const options: string[] = [
    ...available,
    "──",
    "Done",
  ];

  const title = current
    ? `Pick a model for "${tierName}" (current: ${current})`
    : `Pick a model for "${tierName}"`;
  const choice = await ctx.ui.select(title, options);

  if (!choice || choice === "Done") return null;

  // choice is the raw model spec string
  if (choice === current) return null; // no change

  ctx.ui.notify(`"${tierName}" tier → ${choice}`, "info");
  return { ...tiers, [tierName]: choice };
}
