/**
 * Measures false positives and false negatives on the labelled set:
 *   npm run eval
 * "Detected" means the verdict is not 🟢 (suspicious or danger).
 */
import { Engine } from "../analysis/engine.ts";
import { schemeName } from "../analysis/schemes.ts";
import { EVAL_SET } from "../../test/fixtures/eval.ts";

export async function runEval(engine = new Engine()) {
  const rows = [];
  for (const item of EVAL_SET) {
    const v = await engine.check({ text: item.text });
    rows.push({ ...item, level: v.level, score: v.score, scheme: v.schemeId });
  }
  const fraud = rows.filter((r) => r.label === "fraud");
  const legit = rows.filter((r) => r.label === "legit");
  const falseNegatives = fraud.filter((r) => r.level === "no_signs");
  const falsePositives = legit.filter((r) => r.level !== "no_signs");
  return { rows, fraud, legit, falseNegatives, falsePositives };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, fraud, legit, falseNegatives, falsePositives } = await runEval();
  const icon = { danger: "🔴", suspicious: "🟠", no_signs: "🟢" } as const;
  for (const r of rows) {
    const wrong = (r.label === "fraud" && r.level === "no_signs") || (r.label === "legit" && r.level !== "no_signs");
    console.log(`${wrong ? "✗" : " "} ${r.label.padEnd(9)} ${icon[r.level]} ${String(r.score).padStart(3)}  ${(schemeName(r.scheme) ?? r.scheme).slice(0, 40).padEnd(40)}  ${r.text.slice(0, 70)}`);
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  console.log(`\nМошеннические: распознано ${fraud.length - falseNegatives.length}/${fraud.length} (пропуски: ${falseNegatives.length}, ${pct(falseNegatives.length, fraud.length)})`);
  console.log(`Легитимные:    ложных тревог ${falsePositives.length}/${legit.length} (${pct(falsePositives.length, legit.length)})`);
}
