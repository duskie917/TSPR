import { GENERIC_PATTERNS, LEGIT_CHANNEL, SCHEMES, type Pattern } from "./schemes.ts";
import { clamp, type SchemeMatch, type Signal } from "./types.ts";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

const LOOKALIKE: Record<string, string> = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к" };

/**
 * Replace Latin look-alike letters inside otherwise Cyrillic words ("kрeдит" →
 * "кредит"). Pure-Latin words such as URLs are left intact.
 */
export function deobfuscate(text: string): string {
  return text.replace(/[\p{L}]+/gu, (word) => {
    const hasCyr = /[а-яё]/i.test(word);
    const hasLat = /[a-z]/i.test(word);
    if (!hasCyr || !hasLat) return word;
    return word.replace(/[aeopcxykAEOPCXYK]/g, (ch) => {
      const lower = ch.toLowerCase();
      const cyr = LOOKALIKE[lower] ?? ch;
      return ch === lower ? cyr : cyr.toUpperCase();
    });
  });
}

export interface RulesResult {
  schemes: SchemeMatch[];
  signals: Signal[];
  /** The text warns about scammers instead of making requests (a forwarded bank/police warning). */
  awareness: boolean;
  /** True when Latin/Cyrillic letters were mixed inside words — a filter-evasion trick. */
  obfuscated: boolean;
}

/** Imperatives aimed at the reader. Negated ones ("никогда не сообщайте") do not count. */
const DIRECT_REQUEST = /(продиктуй|назов|сообщите мне|скажите мне|переведи|перейди|пришли|отправь|скинь|оплати|установи|скача|введи|войди|займи|одолжи|перезвони|напиши мне)[\p{L}]*/u;

/**
 * A warning about fraud describes scammers in the third person and only gives
 * negative advice. If it also tells the reader to do something, it is not a
 * warning: scammers add "beware of fraudsters" to their own messages too.
 */
export function isAwareness(norm: string): boolean {
  if (!/мошенник/u.test(norm)) return false;
  if (!/(никогда|никому) не (сообща|называ|переда|говор|переход|устанавлива)|будьте (бдительны|осторожны|внимательны)|предупрежда|остерегайтесь/u.test(norm)) return false;
  const withoutNegated = norm.replace(/(никогда |никому )?не [\p{L}]+/gu, " ");
  return !DIRECT_REQUEST.test(withoutNegated);
}

export function analyzeRules(text: string): RulesResult {
  const cleaned = deobfuscate(text);
  const obfuscated = cleaned !== text;
  const norm = normalizeText(cleaned);

  const schemes: SchemeMatch[] = [];
  for (const scheme of SCHEMES) {
    let score = 0;
    const matched: { label: string; stage: Pattern["stage"]; tag?: Pattern["tag"] }[] = [];
    for (const pattern of scheme.patterns) {
      if (pattern.re.test(norm)) {
        score += pattern.weight;
        matched.push({ label: pattern.label, stage: pattern.stage, tag: pattern.tag });
      }
    }
    // A single weak pattern is not enough to name a scheme.
    if (matched.length > 0 && (matched.length >= 2 || score >= 40)) {
      schemes.push({ id: scheme.id, score: clamp(score), matched });
    }
  }
  schemes.sort((a, b) => b.score - a.score);
  // "Code from SMS" is the tool, not the story: when a more specific scheme also
  // matches (bank, operator, police...), name that one.
  const [first, second] = schemes;
  if (first?.id === "sms_code_request" && second && second.matched.length >= 2) {
    schemes[0] = second;
    schemes[1] = first;
  }

  const signals: Signal[] = [];
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.re.test(norm)) signals.push({ text: pattern.label, weight: pattern.weight, source: "rules", stage: pattern.stage, tag: pattern.tag });
  }

  // A request for documents through an official channel ("приходите в отделение
  // с паспортом", "загрузите в приложении банка") is normal, not an attack.
  const legitChannel = LEGIT_CHANNEL.re.test(norm);
  if (legitChannel) {
    for (const s of signals) {
      if (s.tag === "personal_data") {
        s.text = "Просят документы, но через официальный канал (отделение, приложение банка, госпортал)";
        s.weight = 0;
        s.stage = undefined;
        s.tag = "legit_channel";
      }
    }
  }

  // Opportunity or organizer context, but nothing that lets you check who is writing.
  const opportunity = schemes.some((s) => s.matched.some((m) => m.tag === "opportunity")) ||
    /(организатор|оргкомитет|наша организация|наш фонд|наша компания|наш проект|программ\p{L}* (отбор|приглаша))/u.test(norm);
  const identifiable =
    /https?:\/\/|www\.|[a-z0-9-]+\.(kg|com|org|net|ru|kz|uz|edu|gov|int|io)\b/i.test(text) || // a site
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text) || // an e-mail
    /«[^»]{3,}»|"[^"]{3,}"/.test(text) || // a quoted name
    /(?<![\p{L}])[A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*/u.test(text); // a Latin proper name (UNDP, Erasmus)
  if (opportunity && !identifiable) {
    signals.push({ text: "Не указано, кто организатор: нет названия, сайта или официального контакта", weight: 10, source: "rules", stage: "trust", tag: "unverified_org" });
  }
  if (obfuscated) {
    signals.push({ text: "Буквы в словах подменены латиницей — так обходят фильтры", weight: 20, source: "rules", stage: "trust" });
  }
  return { schemes, signals, obfuscated, awareness: isAwareness(norm) };
}
