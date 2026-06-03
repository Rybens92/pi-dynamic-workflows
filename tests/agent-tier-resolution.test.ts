/**
 * Integration tests for tier resolution — pure logic paths.
 *
 * Tests the end-to-end flow of config creation, loading, and
 * tier→model resolution without needing a real Pi SDK session.
 *
 * The runtime path (WorkflowAgent.run() calling createAgentSession
 * with the resolved model) is not tested here since it requires
 * mocking the full Pi SDK, which adds complexity without much
 * additional confidence — the resolution logic itself is what
 * matters most and is fully covered here.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildDefaultTierConfig,
  ensureModelTierConfig,
  resolveTierModel,
  saveModelTierConfig,
} from "../src/model-tier-config.js";

describe("tier resolution — fresh install defaults to current model", () => {
  it("buildDefaultTierConfig with currentModelSpec sets all tiers to it", () => {
    const cfg = buildDefaultTierConfig("user/current-model");
    assert.equal(cfg.tiers.small, "user/current-model");
    assert.equal(cfg.tiers.medium, "user/current-model");
    assert.equal(cfg.tiers.big, "user/current-model");
  });

  it("buildDefaultTierConfig with currentModelSpec returns exactly 3 tiers", () => {
    const cfg = buildDefaultTierConfig("any/model");
    const keys = Object.keys(cfg.tiers);
    assert.deepEqual(keys.sort(), ["big", "medium", "small"]);
  });

  it("buildDefaultTierConfig with undefined uses heuristic (never throws)", () => {
    // This calls listAvailableModelSpecs() which may return empty on CI
    // The important thing is it doesn't throw
    const cfg = buildDefaultTierConfig();
    assert.ok(cfg.tiers, "should have tiers");
    for (const model of Object.values(cfg.tiers)) {
      assert.equal(typeof model, "string", "each tier must be a string");
    }
  });

  it("ensureModelTierConfig with currentModelSpec creates config on fresh install", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");

    const cfg = ensureModelTierConfig(cfgPath, "fresh/model");
    assert.equal(cfg.tiers.small, "fresh/model");
    assert.equal(cfg.tiers.medium, "fresh/model");
    assert.equal(cfg.tiers.big, "fresh/model");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ensureModelTierConfig with currentModelSpec saves config to disk", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");

    ensureModelTierConfig(cfgPath, "saved/model");

    // Reload from disk
    const { loadModelTierConfig } = await import("../src/model-tier-config.js");
    const loaded = loadModelTierConfig(cfgPath);
    assert.ok(loaded, "config should persist to disk");
    assert.equal(loaded?.tiers.small, "saved/model");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ensureModelTierConfig ignores currentModelSpec when config already exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");

    // First call — creates default
    const first = ensureModelTierConfig(cfgPath, "initial/model");
    assert.equal(first.tiers.small, "initial/model");

    // Second call — config exists, should return existing (ignore currentModelSpec)
    const second = ensureModelTierConfig(cfgPath, "different/model");
    assert.equal(second.tiers.small, "initial/model", "should keep existing value");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("tier resolution — get/set/resolve", () => {
  it("resolveTierModel returns configured model from saved config", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");
    saveModelTierConfig({ tiers: { medium: "resolved/model" } }, cfgPath);

    const cfg = ensureModelTierConfig(cfgPath);
    const model = resolveTierModel("medium", cfg);
    assert.equal(model, "resolved/model");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolveTierModel returns undefined for unknown tier", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");
    saveModelTierConfig({ tiers: { small: "any/model" } }, cfgPath);

    const cfg = ensureModelTierConfig(cfgPath);
    const model = resolveTierModel("nonexistent", cfg);
    assert.equal(model, undefined);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full round-trip: defaultConfig → save → load → resolve", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-tier-"));
    const cfgPath = join(tmpDir, "tiers.json");

    const defaults = buildDefaultTierConfig("roundtrip/model");
    saveModelTierConfig(defaults, cfgPath);

    const loaded = ensureModelTierConfig(cfgPath);

    const small = resolveTierModel("small", loaded);
    const medium = resolveTierModel("medium", loaded);
    const big = resolveTierModel("big", loaded);
    assert.equal(small, "roundtrip/model");
    assert.equal(medium, "roundtrip/model");
    assert.equal(big, "roundtrip/model");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
