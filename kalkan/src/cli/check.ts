/**
 * Check a message from the command line:
 *   npm run check -- "Вам одобрен кредит от Нацбанка..."
 *   echo "текст" | npm run check
 */
import { config } from "../config.ts";
import { ClaudeAnalyzer } from "../analysis/ai.ts";
import { Engine } from "../analysis/engine.ts";
import { formatVerdict } from "../analysis/format.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const text = process.argv.slice(2).join(" ") || (await readStdin());
if (!text.trim()) {
  console.error('Usage: npm run check -- "текст сообщения"');
  process.exit(1);
}

const engine = new Engine({
  ai: config.aiEnabled ? new ClaudeAnalyzer() : undefined,
  safeBrowsingKey: config.safeBrowsingKey,
  log: (msg, err) => console.error(`[warn] ${msg}:`, err instanceof Error ? err.message : err),
});
const verdict = await engine.check({ text });
// Strip Telegram HTML for the terminal.
console.log(formatVerdict(verdict).replace(/<\/?(b|i|code)>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
console.log(`\n(AI: ${verdict.aiUsed ? config.model : "off"})`);
