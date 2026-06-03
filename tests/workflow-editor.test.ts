import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Pure-function tests — import from source (tsx compiles on the fly)
async function load() {
  return import("../dist/workflow-editor.js");
}

describe("hasTrigger", () => {
  it('returns true for "workflow"', async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("run a workflow test"), true);
  });

  it('returns true for "workflows"', async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("use workflows mode"), true);
  });

  it("returns true for trigger at start", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("workflow something"), true);
  });

  it("returns true for trigger at end", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("test workflow"), true);
  });

  it("returns true case-insensitively", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("WORKFLOW now"), true);
    assert.equal(hasTrigger("WorkFlows are cool"), true);
  });

  it('returns false for "/workflows" (slash command)', async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("/workflows list"), false);
  });

  it('returns false for "/workflow"', async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("/workflow"), false);
  });

  it("returns false for unrelated text", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("hello world"), false);
  });

  it("returns false for empty string", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger(""), false);
  });

  it('returns false for "working flow" (space in middle)', async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("working flow"), false);
  });

  it("works with non-ASCII characters around the trigger", async () => {
    const { hasTrigger } = await load();
    assert.equal(hasTrigger("zrób workflow test"), true);
    assert.equal(hasTrigger("uruchom workflows"), true);
  });
});

describe("endsWithTrigger", () => {
  it('returns true when text ends with "workflow"', async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger("run a workflow"), true);
  });

  it('returns true when text ends with "workflows"', async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger("see workflows"), true);
  });

  it("returns false when trigger is not at end", async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger("workflow test"), false);
  });

  it('returns false for "/workflows"', async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger("/workflows"), false);
  });

  it("returns false for empty string", async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger(""), false);
  });

  it("returns true with trailing non-ASCII prefix", async () => {
    const { endsWithTrigger } = await load();
    assert.equal(endsWithTrigger("zrób workflow"), true);
  });
});

describe("tokenizeAnsi", () => {
  it("returns one token per char for plain text", async () => {
    const { tokenizeAnsi } = await load();
    const result = tokenizeAnsi("hello");
    assert.equal(result.length, 5);
    assert.deepEqual(result, [{ ch: "h" }, { ch: "e" }, { ch: "l" }, { ch: "l" }, { ch: "o" }]);
  });

  it("preserves CSI sequences as single tokens", async () => {
    const { tokenizeAnsi } = await load();
    const result = tokenizeAnsi("a\x1b[31mb\x1b[0mc");
    assert.equal(result.length, 5);
    assert.equal(result[0].ch, "a");
    assert.equal(result[1].esc, "\x1b[31m");
    assert.equal(result[2].ch, "b");
    assert.equal(result[3].esc, "\x1b[0m");
    assert.equal(result[4].ch, "c");
  });

  it("preserves OSC/APC string sequences (cursor markers)", async () => {
    const { tokenizeAnsi } = await load();
    const result = tokenizeAnsi("a\x1b_pi:c\x07b");
    assert.equal(result.length, 3);
    assert.equal(result[0].ch, "a");
    assert.equal(result[1].esc, "\x1b_pi:c\x07");
    assert.equal(result[2].ch, "b");
  });

  it("handles lone ESC as escape token", async () => {
    const { tokenizeAnsi } = await load();
    const result = tokenizeAnsi("a\x1bXb");
    assert.equal(result.length, 3);
    assert.equal(result[1].esc, "\x1bX");
  });

  it("returns empty array for empty input", async () => {
    const { tokenizeAnsi } = await load();
    assert.deepEqual(tokenizeAnsi(""), []);
  });
});

describe("colorizeWorkflow", () => {
  it("returns line unchanged when no trigger present", async () => {
    const { colorizeWorkflow } = await load();
    assert.equal(colorizeWorkflow("hello world", 0), "hello world");
  });

  it("colorizes workflow with ANSI escapes", async () => {
    const { colorizeWorkflow } = await load();
    const result = colorizeWorkflow("run a workflow", 0);
    // Should contain ANSI escapes around "workflow"
    assert.ok(result.includes("\x1b[38;5;"));
    // Per-character ANSI wrapping (each letter individually colored)
    assert.ok(result.startsWith("run a "));
    assert.ok(result.includes("\x1b[38;5;"));
    assert.ok(result.includes("m"));
  });

  it("returns plain text for empty string", async () => {
    const { colorizeWorkflow } = await load();
    assert.equal(colorizeWorkflow("", 0), "");
  });

  it("preserves existing ANSI in the line", async () => {
    const { colorizeWorkflow } = await load();
    const result = colorizeWorkflow("\x1b[1mworkflow\x1b[0m", 0);
    // The bold marker should survive
    assert.ok(result.includes("\x1b[1m"));
    // work around the trigger letters — the rainbow wraps individual chars
  });

  it("colorizes multiple occurrences", async () => {
    const { colorizeWorkflow } = await load();
    // Use a fixed palette of 2 colors for predictability
    const palette = [196, 46];
    const result = colorizeWorkflow("workflow workflow", 0, palette);
    // Per-character ANSI wrapping — each of the 16 chars (2x "workflow" = 16 chars)
    // should have ANSI color codes around them
    const ansiCodes = result.match(/\x1b\[38;5;\d+m/g);
    assert.equal(ansiCodes.length, 16, "each char of both words should be colored");
  });

  it("handles tick shift producing different colors", async () => {
    const { colorizeWorkflow } = await load();
    const palette = [196, 46];
    const t0 = colorizeWorkflow("workflow", 0, palette);
    const t1 = colorizeWorkflow("workflow", 1, palette);
    // Different tick → different color codes (may differ per char)
    assert.notEqual(t0, t1, "different tick should produce different output");
  });
});

describe("buildForcedWorkflowPrompt", () => {
  it("includes the original text", async () => {
    const { buildForcedWorkflowPrompt } = await load();
    const result = buildForcedWorkflowPrompt("hello world");
    assert.ok(result.startsWith("hello world"));
  });

  it("includes the directive", async () => {
    const { buildForcedWorkflowPrompt } = await load();
    const result = buildForcedWorkflowPrompt("test");
    assert.ok(result.includes("tool named exactly `workflow`"));
    assert.ok(result.includes("MUST"));
  });

  it("is a multi-line string", async () => {
    const { buildForcedWorkflowPrompt } = await load();
    const result = buildForcedWorkflowPrompt("test");
    assert.ok(result.includes("\n"));
    assert.ok(result.includes("---"));
  });
});
