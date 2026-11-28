import { readFileSync, existsSync } from "node:fs";

/** Minimal .env loader so the bot runs with `npm start` and no extra packages. */
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const env = (name: string, fallback = ""): string => process.env[name]?.trim() || fallback;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const config = {
  telegramToken: env("TELEGRAM_BOT_TOKEN"),
  /** Anthropic credentials are resolved by the SDK itself (ANTHROPIC_API_KEY, etc). */
  aiEnabled: env("KALKAN_AI", "on") !== "off" && Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
  model: env("KALKAN_MODEL", "claude-opus-5-5"),
  effort: env("KALKAN_EFFORT", "low") as Effort,
  safeBrowsingKey: env("GOOGLE_SAFE_BROWSING_KEY"),
  virusTotalKey: env("VIRUSTOTAL_API_KEY"),
  dbPath: env("KALKAN_DB", "data/kalkan.db"),
  port: Number(env("PORT", "8080")),
  apiEnabled: env("KALKAN_API", "on") !== "off",
  /** Public demo page + unauthenticated, rate-limited demo endpoint (for pitches). */
  demoEnabled: env("KALKAN_DEMO", "on") !== "off",
  adminIds: env("ADMIN_IDS")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  /** White-label settings for a bank / telecom partner. */
  brand: {
    name: env("BRAND_NAME", "Калкан"),
    partner: env("BRAND_PARTNER"),
    hotline: env("BRAND_HOTLINE"),
  },
};

export const isAdmin = (tgId: number): boolean => config.adminIds.includes(tgId);
