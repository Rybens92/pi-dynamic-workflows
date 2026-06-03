/**
 * Model tier configuration for workflow subagent model routing.
 *
 * Defines tier-based model selection (small/medium/big) that augments
 * the existing model-routing.ts mechanism with enforceable model assignment.
 *
 * A tier is a named slot holding exactly ONE model spec string
 * (e.g. "gpt-4.1-mini"). When an agent() call specifies opts.tier,
 * that single model is resolved and set as opts.model before the
 * subagent session starts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { listAvailableModelSpecs } from "./agent.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Path to the model tiers JSON config file (~/.pi/workflows/model-tiers.json). */
export function getModelTierConfigPath(): string {
  return join(homedir(), ".pi", "workflows", "model-tiers.json");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Model tier configuration.
 * Maps tier names (e.g. "small", "medium", "big") to a single model
 * spec string (e.g. "gpt-4.1-mini" or "openai/gpt-4.1-mini").
 */
export interface ModelTierConfig {
  tiers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/** Big: top reasoning/thinking models. */
function isBigModel(lower: string): boolean {
  return (
    /(opus|o1|o3|o4|pro|deep-research|thinking|01-pro|03-pro|openaio-|reasoning)/.test(lower) ||
    /gpt-5/.test(lower) ||
    /gpt-4(\.|)5/.test(lower) ||
    /claude-sonnet-4(\.|5|6|7|8)/.test(lower) ||
    /gemini-(2\.5-pro|3\.1-pro|3\.5)/.test(lower) ||
    /deepseek-(r1|v3)/.test(lower) ||
    /kimi-k2/.test(lower) ||
    /nexusflux/.test(lower) ||
    /airoboros/.test(lower)
  );
}

/** Small: mini/flash/lite/haiku/nano (but not deep-research or pro). */
function isSmallModel(lower: string): boolean {
  return /(mini|flash|haiku|nano|lite|fast|small)\b/.test(lower) && !/(deep-research|pro)/.test(lower);
}

/**
 * Classify a single model spec string into a suggested tier name.
 *
 * The heuristic uses the model ID (the part after the provider/ prefix)
 * to determine whether the model is "small", "medium", or "big".
 *
 * @param modelSpec - A model spec string, e.g. "openai/gpt-4.1-mini" or "gpt-5".
 * @returns The suggested tier name: "small", "medium", or "big".
 */
export function classifyModelSpec(modelSpec: string): string {
  // Extract the last segment after the final "/" as the model ID.
  // Handles both "provider/id" and "provider/provider/id" patterns.
  const id = modelSpec.includes("/") ? (modelSpec.split("/").pop() ?? modelSpec) : modelSpec;
  const lower = id.toLowerCase();

  if (isBigModel(lower)) return "big";
  if (isSmallModel(lower)) return "small";
  return "medium";
}

/**
 * Classify a list of available model specs into tiers.
 *
 * Maps each model to a suggested tier ("small", "medium", "big")
 * using the same heuristic as `classifyModelSpec()`. Only non-empty
 * tiers are included in the result.
 *
 * @param availableModels - Array of model spec strings.
 * @returns A map of tier name to array of model specs in that tier.
 */
export function classifyModelsToTiers(availableModels: string[]): Record<string, string[]> {
  const small: string[] = [];
  const medium: string[] = [];
  const big: string[] = [];

  for (const spec of availableModels) {
    const tier = classifyModelSpec(spec);
    if (tier === "small") small.push(spec);
    else if (tier === "big") big.push(spec);
    else medium.push(spec);
  }

  const tiers: Record<string, string[]> = {};
  if (small.length > 0) tiers.small = small;
  if (medium.length > 0) tiers.medium = medium;
  if (big.length > 0) tiers.big = big;

  return tiers;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Build a sensible default tier config.
 *
 * When `currentModelSpec` is provided (fresh install or reset to defaults),
 * all tiers are set to the user's currently active Pi model.
 * This ensures a new user sees consistent behavior: every subagent
 * tier defaults to the model they're already chatting with.
 *
 * Without `currentModelSpec` (legacy fallback), uses heuristic
 * classification from available models:
 * - "small":   mini/flash/lite/haiku/nano
 * - "medium":  mid-range (gpt-4.1, claude-sonnet, gemini-pro)
 * - "big":     top-tier (gpt-5/claude-opus/o1/o3)
 *
 * For each tier, the first classified model is selected. If a tier ends
 * up empty, the first model available overall is used as fallback.
 */
export function buildDefaultTierConfig(currentModelSpec?: string): ModelTierConfig {
  if (currentModelSpec) {
    // Fresh install / reset: all tiers = user's current Pi model
    return {
      tiers: {
        small: currentModelSpec,
        medium: currentModelSpec,
        big: currentModelSpec,
      },
    };
  }

  const available = listAvailableModelSpecs();
  const classified = classifyModelsToTiers(available);
  const firstOverall = available[0];

  const small = classified.small?.[0] ?? firstOverall;
  const medium = classified.medium?.[0] ?? firstOverall;
  const big = classified.big?.[0] ?? firstOverall;

  return {
    tiers: {
      small,
      medium,
      big,
    },
  };
}

// ---------------------------------------------------------------------------
// Load / Save / Ensure
// ---------------------------------------------------------------------------

/**
 * Load the model tier config from disk. Returns null if the file does
 * not exist or is unparseable.
 */
export function loadModelTierConfig(configPath?: string): ModelTierConfig | null {
  const path = configPath ?? getModelTierConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.tiers || typeof parsed.tiers !== "object") return null;
    for (const [_key, val] of Object.entries(parsed.tiers)) {
      if (typeof val !== "string") return null;
    }
    return parsed as ModelTierConfig;
  } catch {
    return null;
  }
}

/**
 * Save a model tier config to disk. Creates parent directories if needed.
 */
export function saveModelTierConfig(config: ModelTierConfig, configPath?: string): void {
  const path = configPath ?? getModelTierConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Ensure a model tier config exists and is valid.
 *
 * Loads the config from disk. If no valid config is found (fresh install
 * or corrupt file), builds a default config, persists it, and returns it.
 *
 * When `currentModelSpec` is provided (fresh install), all tiers default
 * to the user's currently active Pi model.
 *
 * @param configPath - Optional override path for the config file.
 * @param currentModelSpec - Optional model spec for fresh-install defaults.
 * @returns A valid {@link ModelTierConfig}.
 */
export function ensureModelTierConfig(configPath?: string, currentModelSpec?: string): ModelTierConfig {
  const existing = loadModelTierConfig(configPath);
  if (existing) return existing;

  const defaults = buildDefaultTierConfig(currentModelSpec);
  saveModelTierConfig(defaults, configPath);
  return defaults;
}

/**
 * Resolve a tier name to a concrete model spec.
 *
 * Returns the single model string configured for the given tier,
 * or undefined if the tier does not exist.
 *
 * @param tier - The tier name (e.g. "small", "medium", "big").
 * @param config - The model tier configuration.
 * @returns The model spec string, or undefined if the tier is not configured.
 */
export function resolveTierModel(tier: string, config: ModelTierConfig): string | undefined {
  return config.tiers[tier];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return all tier names sorted: small < medium < big, then alphabetically.
 */
export function sortedTierNames(config: ModelTierConfig): string[] {
  const names = Object.keys(config.tiers);
  const rank: Record<string, number> = { small: 0, medium: 1, big: 2 };
  return names.sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99) || a.localeCompare(b));
}

/**
 * Pretty-print the tier configuration as a string for display.
 */
export function formatTierConfig(config: ModelTierConfig): string {
  const tiers = sortedTierNames(config);
  const lines = ["Model tier configuration:"];
  for (const name of tiers) {
    const model = config.tiers[name];
    lines.push(`  ${name}: ${model}`);
  }
  return lines.join("\n");
}
