import { clamp, type Signal, type UrlFinding } from "./types.ts";

/**
 * Brands that fraudsters impersonate, with their official domains.
 * TODO before production: confirm every domain with the partner bank/operator.
 */
export const BRANDS: { token: string; name: string; domains: string[] }[] = [
  { token: "nbkr", name: "Нацбанк КР", domains: ["nbkr.kg"] },
  { token: "natsbank", name: "Нацбанк КР", domains: ["nbkr.kg"] },
  { token: "nacbank", name: "Нацбанк КР", domains: ["nbkr.kg"] },
  { token: "mbank", name: "MBANK", domains: ["mbank.kg"] },
  { token: "optima", name: "Оптима Банк", domains: ["optimabank.kg"] },
  { token: "demir", name: "Демир Банк", domains: ["demirbank.kg"] },
  { token: "bakai", name: "Бакай Банк", domains: ["bakai.kg"] },
  { token: "kicb", name: "KICB", domains: ["kicb.net"] },
  { token: "rsk", name: "РСК Банк", domains: ["rsk.kg"] },
  { token: "aiylbank", name: "Айыл Банк", domains: ["ab.kg"] },
  { token: "kompanion", name: "Компаньон", domains: ["kompanion.kg"] },
  { token: "megacom", name: "MegaCom", domains: ["megacom.kg"] },
  { token: "beeline", name: "Beeline", domains: ["beeline.kg", "beeline.ru", "beeline.kz", "beeline.uz"] },
  { token: "lalafo", name: "Lalafo", domains: ["lalafo.kg"] },
  { token: "telegram", name: "Telegram", domains: ["telegram.org", "t.me", "telegram.me"] },
  { token: "whatsapp", name: "WhatsApp", domains: ["whatsapp.com", "wa.me"] },
  { token: "tunduk", name: "Түндүк", domains: ["gov.kg"] },
  { token: "gov", name: "госорган", domains: ["gov.kg", "gov.kz", "gov.uz", "gov.ru", "gov.tj", "gov.uk", "gov"] },
];

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "cutt.ly", "clck.ru", "goo.su", "is.gd", "t.ly", "rb.gy",
  "shorturl.at", "s.id", "tiny.cc", "ow.ly", "u.to", "vk.cc", "surl.li", "qps.ru",
]);

const RISKY_TLDS = new Set([
  "top", "xyz", "icu", "click", "live", "shop", "online", "site", "buzz", "fun", "monster",
  "cfd", "sbs", "rest", "quest", "win", "bond", "lol", "cyou", "store", "website", "space",
  "pw", "tk", "ml", "ga", "cf", "gq", "work", "info", "vip", "pro",
]);

const FREE_HOSTING = [
  "netlify.app", "vercel.app", "pages.dev", "web.app", "firebaseapp.com", "wixsite.com",
  "tilda.ws", "blogspot.com", "glitch.me", "ngrok.io", "ngrok-free.app", "000webhostapp.com",
  "github.io", "weebly.com", "sites.google.com", "forms.gle", "ucoz.net", "workers.dev",
];

const MULTI_PART_SUFFIXES = new Set([
  "com.kg", "org.kg", "net.kg", "gov.kg", "edu.kg", "co.uk", "com.ru", "com.kz", "gov.kz",
  "com.ua", "com.tr", "co.uz", "gov.uz", "com.cn",
]);

const PATH_BAIT = /login|signin|verif|bonus|kompens|vyplat|viplat|credit|kredit|prize|gift|wallet|card|secure|confirm|unblock|payout|vote|golos/i;

/** Parses a link that may be written without a scheme ("site.kg/page"). */
export function toUrl(raw: string): URL {
  return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
}

/** Finds http(s) links and bare domains like "nbkr-credit.top/form" (returned as written). */
export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  const re = /\b((?:https?:\/\/)?(?:[a-z0-9Ѐ-ӿ-]+\.)+(?:[a-zЀ-ӿ]{2,24}|xn--[a-z0-9-]+)(?::\d+)?(?:\/[^\s<>"'«»)]*)?)/giu;
  for (const match of text.matchAll(re)) {
    let candidate = match[1] ?? "";
    candidate = candidate.replace(/[.,;:!?]+$/, "");
    // Skip e-mail addresses and things like "т.е." / numbers like 1.5.
    const before = text[(match.index ?? 0) - 1];
    if (before === "@") continue;
    if (!/[a-zЀ-ӿ]/i.test(candidate.split(/[/:]/)[0] ?? "")) continue;
    if (!/^https?:\/\//i.test(candidate)) {
      const tld = (candidate.split("/")[0] ?? "").split(".").pop() ?? "";
      // Bare words must end in a plausible TLD to count as a link.
      if (!/^[a-z]{2,24}$|^xn--/.test(tld.toLowerCase()) && !/^рф$/.test(tld)) continue;
    }
    found.add(candidate);
  }
  // Raw IP links.
  for (const match of text.matchAll(/\bhttps?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/\S*)?/gi)) {
    found.add(match[0]);
  }
  return [...found];
}

export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** "mbank", "mbankbonus", "nbkrcredit" match; "optimal" does not match "optima". */
function tokenMatch(label: string, token: string): boolean {
  if (label === token) return true;
  if (!label.startsWith(token)) return false;
  return /^(bank|kg|online|bonus|pay|credit|kredit|app|mobile|kz|login|secure|support|help|24|\d+)/.test(label.slice(token.length));
}

/** Undo common visual tricks: "rnbank" → "mbank", "0ptima" → "optima". */
function unconfuse(label: string): string {
  return label.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e");
}

function isOfficial(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Synchronous heuristics. Safe Browsing / community reports are layered on in the engine. */
export function analyzeUrl(raw: string): UrlFinding {
  const signals: Signal[] = [];
  const add = (text: string, weight: number, stage?: Signal["stage"]) => signals.push({ text, weight, source: "url", stage });

  let url: URL;
  try {
    url = toUrl(raw);
  } catch {
    return { url: raw, host: raw, score: 10, signals: [{ text: "Некорректная ссылка", weight: 10, source: "url" }] };
  }
  const host = url.hostname.toLowerCase();
  const reg = registrableDomain(host);
  const labels = host.split(/[.-]/);
  const tld = host.split(".").pop() ?? "";

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) add("Ссылка ведет на IP-адрес вместо названия сайта", 35);
  if (host.includes("xn--") || /[Ѐ-ӿ]/.test(raw.split("/")[2] ?? "")) {
    add("Адрес содержит похожие буквы из другого алфавита (punycode)", 35);
  }
  if (url.username || url.password || raw.split("?")[0]!.includes("@")) {
    add("В ссылке спрятан другой адрес (символ @)", 35);
  }

  const officialHit = BRANDS.some((b) => isOfficial(host, b.domains));
  if (!officialHit) {
    // Brand name inside an unofficial domain: "mbank-bonus.top", "nbkr.credit-kg.com".
    const brand = BRANDS.find((b) => labels.some((l) => tokenMatch(l, b.token)));
    if (brand) {
      add(`Адрес выдает себя за ${brand.name}, но это не официальный сайт (${brand.domains[0]})`, 60, "trust");
    } else {
      // Typosquatting: "rnbank.kg", "optimabamk.kg", "0ptimabank.kg".
      const regLabel = reg.split(".")[0] ?? "";
      outer: for (const b of BRANDS) {
        for (const domain of b.domains) {
          const officialLabel = domain.split(".")[0] ?? "";
          if (officialLabel.length < 5 || regLabel === officialLabel) continue;
          const allowed = officialLabel.length >= 8 ? 2 : 1;
          const distance = levenshtein(regLabel, officialLabel);
          if (unconfuse(regLabel) === officialLabel || (distance > 0 && distance <= allowed)) {
            add(`Адрес очень похож на ${domain}, но это другой сайт`, 55, "trust");
            break outer;
          }
        }
      }
    }
  }

  // Telegram links to bots/channels that pose as a bank or state body.
  if (host === "t.me" || host === "telegram.me") {
    const handle = (url.pathname.split("/")[1] ?? "").toLowerCase();
    const brand = BRANDS.find((b) => b.token !== "telegram" && handle.includes(b.token));
    if (brand) add(`Telegram-аккаунт «${handle}» выдает себя за ${brand.name}`, 45, "trust");
    else if (/kredit|credit|vyplat|bonus|kompens|invest|zarabot|prize/.test(handle)) {
      add(`Telegram-аккаунт «${handle}» с «денежным» названием`, 15);
    }
  }

  if (SHORTENERS.has(reg) || SHORTENERS.has(host)) add("Короткая ссылка скрывает настоящий адрес", 20);
  if (RISKY_TLDS.has(tld)) add(`Доменная зона .${tld} часто используется мошенниками`, 15);
  if (FREE_HOSTING.some((d) => host === d || host.endsWith(`.${d}`))) add("Сайт на бесплатном конструкторе/хостинге", 15);
  if (url.protocol === "http:" && /^https?:\/\//i.test(raw) && !officialHit) add("Сайт без шифрования (http)", 5);
  if ((host.match(/-/g) ?? []).length >= 3) add("Подозрительно длинный адрес с дефисами", 10);
  if (host.split(".").length - reg.split(".").length >= 3) add("Много вложенных поддоменов", 10);
  if (PATH_BAIT.test(host + url.pathname + url.search) && !officialHit) add("В ссылке «денежные» слова: бонус, выплата, кредит, вход", 10);

  const score = clamp(signals.reduce((sum, s) => sum + s.weight, 0));
  return { url: raw, host, score, signals };
}

/**
 * Google Safe Browsing v4 lookup (free key from Google Cloud).
 * Returns the set of URLs flagged as malicious/phishing.
 */
export async function safeBrowsingLookup(urls: string[], apiKey: string): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (!apiKey || urls.length === 0) return flagged;
  const body = {
    client: { clientId: "kalkan-bot", clientVersion: "0.1.0" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: urls.map((url) => ({ url })),
    },
  };
  const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Safe Browsing HTTP ${res.status}`);
  const data = (await res.json()) as { matches?: { threat?: { url?: string } }[] };
  for (const m of data.matches ?? []) if (m.threat?.url) flagged.add(m.threat.url);
  return flagged;
}
