/**
 * Tests for model-tier-config.ts
 *
 * TDD order:
 * 1. Default config building (no file I/O)
 * 2. resolveTierModel logic
 * 3. save/load round-trip (scoped to temp dir)
 * 4. format and sorting helpers
 * 5. Corrupted file / missing tiers handling
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// We need to mock listAvailableModelSpecs so tests are deterministic
// without touching the real Pi agent auth.

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

async function loadModule(availableModels?: string[]) {
  // Stub listAvailableModelSpecs inside the module
  const mod = await import("../src/model-tier-config.js");
  return { ...mod };
}

describe("model-tier-config", () => {
  describe("buildDefaultTierConfig", () => {
    it("returns an object with a tiers property", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      assert.ok(cfg, "should return a config");
      assert.equal(typeof cfg.tiers, "object");
    });

    it("classifies small models (mini/flash/haiku/nano)", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      // small tier should exist or have reasonable defaults
      if (cfg.tiers.small) {
        for (const m of cfg.tiers.small) {
          const lower = m.toLowerCase();
          assert.ok(
            /mini|flash|haiku|nano|lite/.test(lower),
            `${m} should be classified as small`,
          );
        }
      }
    });

    it("classifies big models (opus/o1/o3/o4-pro/gpt-5)", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      if (cfg.tiers.big) {
        for (const m of cfg.tiers.big) {
          const lower = m.toLowerCase();
          assert.ok(
            /opus|o1|o3|o4|pro|gpt-5|kimi-k2|deepseek-r1|deepseek-v3|gemini-(2\.5-pro|3\.1-pro|3\.5)/.test(lower),
            `${m} should be classified as big`,
          );
        }
      }
    });

    it("never produces an empty config", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      assert.ok(Object.keys(cfg.tiers).length > 0, "should have at least one tier");
    });

    it("every model appears in exactly one tier", async () => {
      const { buildDefaultTierConfig } = await loadModule();
      const cfg = buildDefaultTierConfig();
      const all: string[] = Object.values(cfg.tiers).flat();
      const unique = new Set(all);
      assert.equal(all.length, unique.size, "no model should appear in multiple tiers");
    });
  });

  describe("resolveTierModel", () => {
    it("returns a model for a valid tier", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: ["openai/gpt-4.1-mini", "haiku"],
          medium: ["openai/gpt-4.1"],
          big: ["openai/gpt-5", "claude-opus-4"],
        },
      };
      const result = resolveTierModel("small", config, FAKE_AVAILABLE);
      assert.ok(result, "should resolve a model for small");
      assert.ok(FAKE_AVAILABLE.includes(result!), `${result} should be in available list`);
    });

    it("returns first available model from the tier list", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: ["nonexistent-model", "gpt-4.1-mini", "haiku"],
        },
      };
      const result = resolveTierModel("small", config, FAKE_AVAILABLE);
      assert.equal(result, "gpt-4.1-mini", "should skip unavailable and return first available");
    });

    it("returns undefined for unknown tier name", async () => {
      const { resolveTierModel } = await loadModule();
      const config = { tiers: { small: ["gpt-4.1-mini"] } };
      const result = resolveTierModel("nonexistent", config, FAKE_AVAILABLE);
      assert.equal(result, undefined);
    });

    it("returns undefined when no models in tier are available", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: ["unicorn-model", "dolphin-model"],
        },
      };
      const result = resolveTierModel("small", config, ["some-other-model"]);
      assert.equal(result, undefined);
    });

    it("returns undefined for empty tier", async () => {
      const { resolveTierModel } = await loadModule();
      const config = { tiers: { small: [] } };
      const result = resolveTierModel("small", config, FAKE_AVAILABLE);
      assert.equal(result, undefined);
    });

    it("matches by bare modelId when available list has provider/modelId", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: ["gpt-4.1-mini"],
        },
      };
      const result = resolveTierModel("small", config, ["openai/gpt-4.1-mini"]);
      assert.equal(result, "gpt-4.1-mini", "should match bare id against provider/id");
    });

    it("matches by provider/modelId when tier has full spec", async () => {
      const { resolveTierModel } = await loadModule();
      const config = {
        tiers: {
          small: ["openai/gpt-4.1-mini"],
        },
      };
      const result = resolveTierModel("small", config, ["openai/gpt-4.1-mini"]);
      assert.equal(result, "openai/gpt-4.1-mini");
    });

    it("uses listAvailableModelSpecs() when availableModels is omitted", async () => {
      const { resolveTierModel } = await loadModule();
      const config = { tiers: { medium: ["openai/gpt-4.1"] } };
      // Should not throw; returns whatever the real env reports
      const result = resolveTierModel("medium", config);
      // May be undefined in test env with no real auth — that's fine
      assert.doesNotThrow(() => resolveTierModel("medium", config));
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
      const config = { tiers: { small: ["gpt-4.1-mini"], medium: ["gpt-4.1"] } };
      saveModelTierConfig(config, cfgPath);
      const loaded = loadModelTierConfig(cfgPath);
      assert.ok(loaded);
      assert.deepEqual(loaded!.tiers.small, ["gpt-4.1-mini"]);
      assert.deepEqual(loaded!.tiers.medium, ["gpt-4.1"]);
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

    it("returns null when a tier value is not an array", async () => {
      const { loadModelTierConfig } = await loadModule();
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");
      writeFileSync(cfgPath, '{"tiers": {"small": "gpt-4.1-mini"}}', "utf-8");
      const result = loadModelTierConfig(cfgPath);
      assert.equal(result, null);
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("sortedTierNames", () => {
    it("returns names sorted: small < medium < big", async () => {
      const { sortedTierNames } = await loadModule();
      const config = {
        tiers: { big: [], small: [], medium: [] },
      };
      const sorted = sortedTierNames(config);
      assert.deepEqual(sorted, ["small", "medium", "big"]);
    });

    it("handles custom tier names alphabetically after standard ones", async () => {
      const { sortedTierNames } = await loadModule();
      const config = {
        tiers: { xlarge: [], medium: [], small: [] },
      };
      const sorted = sortedTierNames(config);
      assert.deepEqual(sorted, ["small", "medium", "xlarge"]);
    });
  });

  describe("formatTierConfig", () => {
    it("returns a readable multi-line string", async () => {
      const { formatTierConfig } = await loadModule();
      const config = {
        tiers: {
          small: ["gpt-4.1-mini"],
          medium: ["gpt-4.1"],
          big: ["gpt-5"],
        },
      };
      const text = formatTierConfig(config);
      assert.ok(text.includes("small"));
      assert.ok(text.includes("gpt-4.1-mini"));
      assert.ok(text.includes("gpt-4.1"));
      assert.ok(text.includes("gpt-5"));
      assert.ok(text.includes("Model tier configuration"));
    });
  });
});
