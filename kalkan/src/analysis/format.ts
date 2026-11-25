import { config } from "../config.ts";
import { formatPhone } from "./phones.ts";
import { schemeName } from "./schemes.ts";
import type { Verdict } from "./types.ts";

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const LEVEL_TITLE: Record<Verdict["level"], string> = {
  danger: "🔴 Очень похоже на мошенничество",
  suspicious: "🟠 Есть признаки мошенничества — будьте осторожны",
  no_signs: "🟢 Явных признаков мошенничества не найдено",
};

/** Telegram HTML message for a verdict. */
export function formatVerdict(v: Verdict): string {
  const lines: string[] = [`<b>${LEVEL_TITLE[v.level]}</b>`];
  const name = v.schemeId !== "none" ? (schemeName(v.schemeId) ?? (v.schemeId === "other" ? "Другая мошенническая схема" : undefined)) : undefined;
  if (name && v.level !== "no_signs") lines.push(`Похоже на схему: <b>${escapeHtml(name)}</b>`);
  lines.push(`Уровень риска: ${v.score}/100`);

  if (v.explanation) lines.push("", escapeHtml(v.explanation));

  const flags = v.signals.slice(0, 6);
  if (flags.length > 0 && v.level !== "no_signs") {
    lines.push("", "<b>Что настораживает:</b>", ...flags.map((s) => `• ${escapeHtml(s.text)}`));
  } else if (flags.length > 0) {
    lines.push("", "<b>На что обратить внимание:</b>", ...flags.slice(0, 3).map((s) => `• ${escapeHtml(s.text)}`));
  }

  const risky = v.urls.filter((u) => u.score >= 35);
  if (risky.length) lines.push("", `⛔ Не открывайте: ${risky.map((u) => `<code>${escapeHtml(u.host)}</code>`).join(", ")}`);
  const riskyPhones = v.phones.filter((p) => p.score >= 35);
  if (riskyPhones.length) lines.push(`⛔ Не перезванивайте: ${riskyPhones.map((p) => `<code>${formatPhone(p.normalized)}</code>`).join(", ")}`);

  if (v.advice.length) lines.push("", "<b>Что делать:</b>", ...v.advice.map((a, i) => `${i + 1}. ${escapeHtml(a)}`));

  if (v.level === "no_signs") {
    lines.push("", "<i>Бот не дает гарантий. Если сомневаетесь — спросите близких или позвоните в организацию по официальному номеру.</i>");
  }
  if (config.brand.hotline && v.level !== "no_signs") {
    lines.push("", `📞 Горячая линия ${escapeHtml(config.brand.partner || "банка")}: ${escapeHtml(config.brand.hotline)}`);
  }
  if (!v.aiUsed && v.aiError) lines.push("", "<i>Проверено по базе схем (ИИ-анализ сейчас недоступен).</i>");
  return lines.join("\n");
}

/** Public JSON shape for the B2B API. */
export function verdictJson(v: Verdict) {
  return {
    level: v.level,
    score: v.score,
    scheme: v.schemeId === "none" ? null : { id: v.schemeId, name: schemeName(v.schemeId) ?? null },
    red_flags: v.signals.slice(0, 8).map((s) => ({ text: s.text, source: s.source })),
    explanation: v.explanation ?? null,
    advice: v.advice,
    urls: v.urls.map((u) => ({ url: u.url, host: u.host, score: u.score })),
    phones: v.phones.map((p) => ({ phone: `+${p.normalized}`, score: p.score })),
    ai_used: v.aiUsed,
    disclaimer: "Оценка вероятностная и не является гарантией безопасности.",
  };
}
