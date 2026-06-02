/**
 * Tests for workflows-models-command.ts
 *
 * Since pi.registerCommand and ctx.ui functions are only available at runtime
 * inside Pi, these tests focus on the pure logic: command creation,
 * the editSingleTier single-select helper, and integration with model-tier-config.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

async function loadCommand() {
  const mod = await import("../src/workflows-models-command.js");
  return mod;
}

describe("workflows-models-command", () => {
  describe("registerWorkflowModelsCommand", () => {
    it("registers the workflows-models command with Pi", async () => {
      const { registerWorkflowModelsCommand } = await loadCommand();
      const commands: string[] = [];
      const mockPi = {
        registerCommand: mock.fn((name: string, _opts: unknown) => {
          commands.push(name);
        }),
      };

      registerWorkflowModelsCommand(mockPi as never);

      assert.equal(mockPi.registerCommand.mock.callCount(), 1);
      assert.equal(commands[0], "workflows-models");
    });

    it("provides a description", async () => {
      const { registerWorkflowModelsCommand } = await loadCommand();
      let capturedDescription = "";

      const mockPi = {
        registerCommand: mock.fn(
          (_name: string, opts: { description?: string }) => {
            capturedDescription = opts.description ?? "";
          },
        ),
      };

      registerWorkflowModelsCommand(mockPi as never);
      assert.ok(
        capturedDescription.length > 0,
        "description should not be empty",
      );
      assert.ok(
        capturedDescription.toLowerCase().includes("tier"),
        "description should mention tiers",
      );
    });
  });

  describe("editSingleTier", () => {
    it("exports editSingleTier function", async () => {
      const mod = await import("../src/workflows-models-command.js");
      assert.equal(typeof mod.editSingleTier, "function");
    });

    it("returns null when user selects Done", async () => {
      const { editSingleTier } = await import("../src/workflows-models-command.js");
      const ctx = {
        ui: {
          select: mock.fn(() => Promise.resolve("Done")),
          notify: mock.fn(),
        },
      };
      const tiers: Record<string, string> = { small: "gpt-4.1-mini" };

      const result = await editSingleTier(ctx as never, tiers, "small");
      assert.equal(result, null);
    });

    it("returns null when select returns undefined", async () => {
      const { editSingleTier } = await import("../src/workflows-models-command.js");
      const ctx = {
        ui: {
          select: mock.fn(() => Promise.resolve(undefined)),
          notify: mock.fn(),
        },
      };
      const tiers: Record<string, string> = { small: "gpt-4.1-mini" };

      const result = await editSingleTier(ctx as never, tiers, "small");
      assert.equal(result, null);
    });

    it("returns null when user selects the same model (no change)", async () => {
      const { editSingleTier } = await import("../src/workflows-models-command.js");
      // Simulate selecting the same current model
      const ctx = {
        ui: {
          select: mock.fn(async (_title: string, opts: string[]) => {
            const currentOpt = opts.find((o) => o.startsWith("→ "));
            return currentOpt;
          }),
          notify: mock.fn(),
        },
      };
      const tiers: Record<string, string> = { small: "gpt-4.1-mini" };

      const result = await editSingleTier(ctx as never, tiers, "small");
      assert.equal(result, null); // no change
    });

    it("selects a different model and returns updated tiers", async () => {
      const { editSingleTier } = await import("../src/workflows-models-command.js");
      // Simulate selecting a different model
      const ctx = {
        ui: {
          select: mock.fn(async (_title: string, opts: string[]) => {
            // Return the first non-current model
            const newModel = opts.find((o) => o.startsWith("  "));
            return newModel;
          }),
          notify: mock.fn(),
        },
      };
      const tiers: Record<string, string> = { small: "gpt-4.1-mini" };

      const result = await editSingleTier(ctx as never, tiers, "small");
      assert.ok(result, "should return updated tiers");
      assert.notEqual(result.small, "gpt-4.1-mini", "should have changed model");
      assert.equal(typeof result.small, "string", "should still be a string");
    });
  });

  describe("integration with model-tier-config", () => {
    it("ensureModelTierConfig creates default on fresh install", async () => {
      const { ensureModelTierConfig } = await import(
        "../src/model-tier-config.js"
      );
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-cmd-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");

      const config = ensureModelTierConfig(cfgPath);
      assert.ok(config.tiers, "should have tiers");
      for (const model of Object.values(config.tiers)) {
        assert.equal(typeof model, "string", "each tier value should be a string");
      }

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("save/load round-trip works with single-model config", async () => {
      const { saveModelTierConfig, loadModelTierConfig } = await import(
        "../src/model-tier-config.js"
      );
      const tmpDir = mkdtempSync(join(tmpdir(), "mtc-cmd-test-"));
      const cfgPath = join(tmpDir, "model-tiers.json");

      const config = {
        tiers: {
          small: "gpt-4.1-mini",
          medium: "gpt-4.1",
          big: "gpt-5",
        },
      };

      saveModelTierConfig(config, cfgPath);
      const loaded = loadModelTierConfig(cfgPath);
      assert.ok(loaded);
      assert.equal(loaded!.tiers.small, "gpt-4.1-mini");
      assert.equal(loaded!.tiers.medium, "gpt-4.1");
      assert.equal(loaded!.tiers.big, "gpt-5");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
