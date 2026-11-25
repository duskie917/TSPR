import { test } from "node:test";
import assert from "node:assert/strict";
import { runEval } from "../src/cli/eval.ts";

// Targets on the labelled set in test/fixtures/eval.ts. Raise the bar, never lower it.
test("eval set: no missed fraud, no false alarms on legitimate messages", async () => {
  const { falseNegatives, falsePositives, fraud, legit } = await runEval();
  assert.ok(fraud.length >= 20 && legit.length >= 15, "eval set is too small");
  assert.deepEqual(falseNegatives.map((r) => r.text), [], "missed fraud");
  assert.deepEqual(falsePositives.map((r) => r.text), [], "false alarms");
});
