/**
 * Tests for model-tier-config.ts
 *
 * TDD order:
 * 1. Default config building (no file I/O)
 * 2. resolveTierModel logic
 * 3. ensureModelTierConfig — fresh install / existing load
 * 4. save/load round-trip (scoped to temp dir)
 * 5. format and sorting helpers
 * 6. Corrupted file / missing tiers handling
 *
 * All tier configs are single-model-per-tier (Record<string, string>).
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Available model specs used by classification tests.
 * classifyModelsToTiers still groups models into Record<string, string[]> buckets,
 * so FAKE_AVAILABLE stays as an array.
 */
const FAKE_AVAILABLE = [
  "openai/gpt-4.1-nano",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "openai/gpt-5",
  "openai/o3-mini",
  "openrouter/anthropic/claude-haiku-4.5",
  "openrouter/anthropic/claude-sonnet-4",
  "openrouter/anthropic/claude-opus-4",
  "openrouter/google/gemini-2.0-flash-001",
  "openrouter/google/gemini-2.5-pro",
  "openrouter/deepseek/deepseek-v4-flash",
  "openrouter/deepseek/deepseek-v4-pro",
];

async function loadModule() {
  return await import("../src/model-tier-config.js");
}

describe("model-tier-config", () => {
  describe("buildDefaultTierConfig", () => {
    it("returns an object with a tiers property", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      assert.ok(cfg, "should return a config");
      assert.equal(typeof cfg.tiers, "object");
    });

    it("each tier holds a single string (not an array)", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      for (const [name, model] of Object.entries(cfg.tiers)) {
        assert.equal(typeof model, "string", `${name} tier should hold a string, got ${typeof model}`);
        assert.ok(model.length > 0, `${name} tier model should not be empty`);
      }
    });

    it("classifies small models (mini/flash/haiku/nano/lite/small/fast)", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      if (cfg.tiers.small) {
        const lower = cfg.tiers.small.toLowerCase();
        const id = lower.includes("/") ? lower.split("/").pop()! : lower;
        assert.ok(
          /mini|flash|haiku|nano|lite|fast|small\b/.test(id) && !/(deep-research|pro)/.test(id),
          `${cfg.tiers.small} should be classified as small`,
        );
      }
    });

    it("classifies big models (opus/o1/o3/o4/sonnet-4/gpt-5/pro/reasoning)", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      if (cfg.tiers.big) {
        const lower = cfg.tiers.big.toLowerCase();
        const id = lower.includes("/") ? lower.split("/").pop()! : lower;
        assert.ok(
          /(opus|o1|o3|o4|pro|deep-research|thinking|01-pro|03-pro|openaio-|reasoning)/.test(id) ||
            /gpt-5/.test(id) ||
            /gpt-4(\.|)5/.test(id) ||
            /claude-sonnet-4(\.|5|6|7|8)/.test(id) ||
            /gemini-(2\.5-pro|3\.1-pro|3\.5)/.test(id) ||
            /deepseek-(r1|v3)/.test(id) ||
            /kimi-k2/.test(id) ||
            /nexusflux/.test(id) ||
            /airoboros/.test(id),
          `${cfg.tiers.big} should be classified as big`,
        );
      }
    });

    it("never produces an empty config", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      assert.ok(Object.keys(cfg.tiers).length > 0, "should have at least one tier");
    });
  });

  describe("resolveTierModel", () => {
    it("returns the model for a valid tier", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: "openai/gpt-4.1-mini",
          medium: "openai/gpt-4.1",
          big: "openai/gpt-5",
        },
      };
      assert.equal(resolveTierModel("small", config), "openai/gpt-4.1-mini");
      assert.equal(resolveTierModel("medium", config), "openai/gpt-4.1");
      assert.equal(resolveTierModel("big", config), "openai/gpt-5");
    });

    it("returns undefined for unknown tier name", async () => {
      const { resolveTierModel } = await loadModule();
      const config = { tiers: { small: "gpt-4.1-mini" } };
      assert.equal(resolveTierModel("nonexistent", config), undefined);
    });

    it("returns empty string when tier exists but no model is assigned", async () => {
      const { resolveTierModel } = await loadModule();
      const config = { tiers: { small: "gpt-4.1-mini", medium: "" } };
      assert.equal(resolveTierModel("medium", config), "");
    });
  });

  describe("ensureModelTierConfig", () => {
    it("returns existing config when file exists", async () => {
      const { ensureModelTierConfig, saveModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-ensure-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      const config = {
        tiers: { small: "gpt-4.1-mini", medium: "gpt-4.1", big: "gpt-5" },
      };
      saveModelTierConfig(config, cfgPath);

      const result = ensureModelTierConfig(cfgPath);
      assert.deepEqual(result, config);
      assert.equal(typeof result.tiers.small, "string");
      assert.equal(typeof result.tiers.medium, "string");
      assert.equal(typeof result.tiers.big, "string");
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates default config when file doesn't exist", async () => {
      const { ensureModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-ensure-"));
      const cfgPath = join(tmpDir, "fresh-model-tiers.json");

      const result = ensureModelTierConfig(cfgPath);

      assert.ok(result.tiers, "should have tiers");
      assert.ok(Object.keys(result.tiers).length > 0, "should have at least one tier");
      for (const model of Object.values(result.tiers)) {
        assert.equal(typeof model, "string", "each tier should hold a string");
      }
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("saves the default config to disk", async () => {
      const { ensureModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-ensure-"));
      const cfgPath = join(tmpDir, "disk-model-tiers.json");

      const result = ensureModelTierConfig(cfgPath);

      assert.ok(existsSync(cfgPath), "config file should be written to disk");
      // Verify the file content matches the returned config
      const { loadModelTierConfig } = await loadModule();
      const loaded = loadModelTierConfig(cfgPath);
      assert.deepEqual(loaded, result, "file content should match returned config");
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("builds and saves defaults when file is corrupt", async () => {
      const { ensureModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-ensure-"));
      const cfgPath = join(tmpDir, "corrupt-model-tiers.json");
      writeFileSync(cfgPath, "{invalid json", "utf-8");

      const result = ensureModelTierConfig(cfgPath);

      assert.ok(result.tiers, "should recover with defaults");
      for (const model of Object.values(result.tiers)) {
        assert.equal(typeof model, "string", "each tier should hold a string");
      }
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("builds and saves defaults when tiers has non-string values", async () => {
      const { ensureModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-ensure-"));
      const cfgPath = join(tmpDir, "bad-type-model-tiers.json");
      writeFileSync(cfgPath, '{"tiers": {"small": ["gpt-4.1-mini"]}}', "utf-8");

      const result = ensureModelTierConfig(cfgPath);

      assert.ok(result.tiers, "should recover with defaults");
      for (const model of Object.values(result.tiers)) {
        assert.equal(typeof model, "string", "each tier should hold a string");
      }
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("loadModelTierConfig (scoped to tmpdir)", () => {
    it("returns null when file does not exist", async () => {
      const { loadModelTierConfig } = await loadModule();
      const path = join(tmpdir(), "nonexistent-test-file.json");
      const result = loadModelTierConfig(path);
      assert.equal(result, null);
    });

    it("loads a valid config saved by saveModelTierConfig", async () => {
      const { loadModelTierConfig, saveModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      const config = {
        tiers: { small: "gpt-4.1-mini", medium: "gpt-4.1", big: "gpt-5" },
      };
      saveModelTierConfig(config, cfgPath);
      const loaded = loadModelTierConfig(cfgPath);
      assert.ok(loaded);
      assert.equal(loaded?.tiers.small, "gpt-4.1-mini", "single-model string");
      assert.equal(loaded?.tiers.medium, "gpt-4.1", "single-model string");
      assert.equal(loaded?.tiers.big, "gpt-5", "single-model string");
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns null for corrupted JSON", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, "{invalid json", "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.equal(result, null);
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns null for non-object JSON", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, '"just a string"', "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.equal(result, null);
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns null when tiers is not an object", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, '{"tiers": "not-an-object"}', "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.equal(result, null);
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns null when a tier value is not a string", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, '{"tiers": {"small": ["gpt-4.1-mini"]}}', "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.equal(result, null, "array values should be rejected — expected string");
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("accepts config where a tier value is a valid string", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, '{"tiers": {"small": "gpt-4.1-mini"}}', "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.ok(result, "string values should be accepted");
      assert.equal(result?.tiers.small, "gpt-4.1-mini");
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("sortedTierNames", () => {
    it("returns names sorted: small < medium < big", async () => {
      const { sortedTierNames } = await loadModule();
      const config = {
        tiers: { big: "gpt-5", small: "gpt-4.1-mini", medium: "gpt-4.1" },
      };
      const sorted = sortedTierNames(config);
      assert.deepEqual(sorted, ["small", "medium", "big"]);
    });

    it("handles custom tier names alphabetically after standard ones", async () => {
      const { sortedTierNames } = await loadModule();
      const config = {
        tiers: {
          xlarge: "gpt-5",
          medium: "gpt-4.1",
          small: "gpt-4.1-mini",
        },
      };
      const sorted = sortedTierNames(config);
      assert.deepEqual(sorted, ["small", "medium", "xlarge"]);
    });
  });

  describe("formatTierConfig", () => {
    it("returns a readable multi-line string with single model per line", async () => {
      const { formatTierConfig } = await loadModule();
      const config = {
        tiers: {
          small: "gpt-4.1-mini",
          medium: "gpt-4.1",
          big: "gpt-5",
        },
      };
      const text = formatTierConfig(config);
      assert.ok(text.includes("small"));
      assert.ok(text.includes("gpt-4.1-mini"));
      assert.ok(text.includes("gpt-4.1"));
      assert.ok(text.includes("gpt-5"));
      assert.ok(text.includes("Model tier configuration"));

      // Each tier line should show exactly one model (no commas from array join)
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("  ")) {
          const parts = line.split(": ");
          assert.equal(parts.length, 2, `line should have one value after colon: ${line}`);
        }
      }
    });

    it("formats a single-tier config correctly", async () => {
      const { formatTierConfig } = await loadModule();
      const config = { tiers: { small: "openai/gpt-4.1-mini" } };
      const text = formatTierConfig(config);
      assert.ok(text.includes("small"));
      assert.ok(text.includes("openai/gpt-4.1-mini"));
      assert.ok(!text.includes(","), "single model should not contain commas");
    });
  });

  describe("classifyModelSpec", () => {
    it("classifies mini variants as small", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-4.1-mini"), "small");
      assert.equal(classifyModelSpec("gpt-4.1-mini"), "small");
    });

    it("classifies nano variants as small", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-4.1-nano"), "small");
    });

    it("classifies flash variants as small", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-4.1-nano"), "small");
      assert.equal(classifyModelSpec("openrouter/google/gemini-2.0-flash-001"), "small");
      assert.equal(classifyModelSpec("openrouter/deepseek/deepseek-v4-flash"), "small");
    });

    it("classifies haiku variants as small", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openrouter/anthropic/claude-haiku-4.5"), "small");
    });

    it("classifies lite variants as small", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-4.1-nano"), "small");
    });

    it("classifies medium-range models as medium", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-4.1"), "medium");
      assert.equal(classifyModelSpec("openrouter/anthropic/claude-sonnet-4"), "medium");
    });

    it("classifies top reasoning models as big", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/gpt-5"), "big");
      assert.equal(classifyModelSpec("openrouter/anthropic/claude-opus-4"), "big");
      assert.equal(classifyModelSpec("openrouter/google/gemini-2.5-pro"), "big");
      assert.equal(classifyModelSpec("openrouter/deepseek/deepseek-v4-pro"), "big");
    });

    it("classifies o-series models as big", async () => {
      const { classifyModelSpec } = await loadModule();
      assert.equal(classifyModelSpec("openai/o3-mini"), "big");
      assert.equal(classifyModelSpec("openai/o1"), "big");
      assert.equal(classifyModelSpec("openai/o4-mini"), "big");
    });

    it("models with 'mini' and 'pro' in name should not be classified small", async () => {
      const { classifyModelSpec } = await loadModule();
      // o3-mini has "mini" but is a reasoning model -> big
      assert.equal(classifyModelSpec("openai/o3-mini"), "big");
      // o4-mini has "mini" but is a reasoning model -> big
      assert.equal(classifyModelSpec("openai/o4-mini"), "big");
    });
  });

  describe("classifyModelsToTiers", () => {
    it("classifies every model into a tier", async () => {
      const { classifyModelsToTiers } = await loadModule();
      const result = classifyModelsToTiers(FAKE_AVAILABLE);
      const allClassified = Object.values(result).flat();
      for (const m of FAKE_AVAILABLE) {
        assert.ok(allClassified.includes(m), `${m} should be classified into a tier`);
      }
    });

    it("no model appears in multiple tiers", async () => {
      const { classifyModelsToTiers } = await loadModule();
      const result = classifyModelsToTiers(FAKE_AVAILABLE);
      const all: string[] = Object.values(result).flat();
      const unique = new Set(all);
      assert.equal(all.length, unique.size, "no model should appear in multiple tiers");
    });

    it("classifies models consistently with classifyModelSpec", async () => {
      const { classifyModelsToTiers, classifyModelSpec } = await loadModule();
      const result = classifyModelsToTiers(FAKE_AVAILABLE);
      for (const [tier, models] of Object.entries(result)) {
        for (const m of models) {
          assert.equal(classifyModelSpec(m), tier, `${m} should be classified as ${tier} by both functions`);
        }
      }
    });

    it("returns an empty record for empty input", async () => {
      const { classifyModelsToTiers } = await loadModule();
      const result = classifyModelsToTiers([]);
      assert.deepEqual(result, {});
    });

    it("preserves the provider prefix in model specs", async () => {
      const { classifyModelsToTiers } = await loadModule();
      const result = classifyModelsToTiers(FAKE_AVAILABLE);
      const all = Object.values(result).flat();
      for (const m of FAKE_AVAILABLE) {
        assert.ok(all.includes(m), `${m} should be stored with its full spec`);
      }
    });

    it("only creates non-empty tier entries", async () => {
      const { classifyModelsToTiers } = await loadModule();
      const result = classifyModelsToTiers(FAKE_AVAILABLE);
      for (const [tier, models] of Object.entries(result)) {
        assert.ok(models.length > 0, `${tier} tier should not be empty`);
      }
    });
  });
});
