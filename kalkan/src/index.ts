import { config } from "./config.ts";
import { ClaudeAnalyzer } from "./analysis/ai.ts";
import { Engine } from "./analysis/engine.ts";
import { createApi } from "./api/server.ts";
import { createBot } from "./bot/bot.ts";
import { Store } from "./storage/db.ts";

const store = new Store(config.dbPath);
const engine = new Engine({
  ai: config.aiEnabled ? new ClaudeAnalyzer() : undefined,
  reports: store,
  safeBrowsingKey: config.safeBrowsingKey,
  virusTotalKey: config.virusTotalKey,
  log: (msg, err) => console.warn(`[warn] ${msg}:`, err instanceof Error ? err.message : err),
});

console.log(`${config.brand.name}: AI ${config.aiEnabled ? `on (${config.model}, effort ${config.effort})` : "off — rules only"}`);
console.log(`Safe Browsing: ${config.safeBrowsingKey ? "on" : "off"}, VirusTotal: ${config.virusTotalKey ? "on" : "off"}`);

if (config.apiEnabled || config.demoEnabled) {
  const server = createApi({ engine, store, demo: config.demoEnabled });
  server.listen(config.port, () => console.log(`HTTP API${config.demoEnabled ? " + demo page" : ""}: http://localhost:${config.port}`));
}

if (config.telegramToken) {
  const bot = createBot(config.telegramToken, { engine, store, aiEnabled: config.aiEnabled });
  await bot.api.setMyCommands([
    { command: "start", description: "Начать" },
    { command: "family", description: "Семейный режим" },
    { command: "report", description: "Пожаловаться на номер или сайт" },
    { command: "help", description: "Как пользоваться" },
    { command: "privacy", description: "Какие данные мы храним" },
  ]);
  const stop = () => bot.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await bot.start({ onStart: (me) => console.log(`Telegram bot @${me.username} is running`) });
} else {
  console.log("TELEGRAM_BOT_TOKEN is not set — the Telegram bot is off (API/demo only).");
}
