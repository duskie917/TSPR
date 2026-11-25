import { GENERIC_PATTERNS, SCHEMES } from "./schemes.ts";
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
  /** True when Latin/Cyrillic letters were mixed inside words — a filter-evasion trick. */
  obfuscated: boolean;
}

export function analyzeRules(text: string): RulesResult {
  const cleaned = deobfuscate(text);
  const obfuscated = cleaned !== text;
  const norm = normalizeText(cleaned);

  const schemes: SchemeMatch[] = [];
  for (const scheme of SCHEMES) {
    let score = 0;
    const matched: string[] = [];
    for (const pattern of scheme.patterns) {
      if (pattern.re.test(norm)) {
        score += pattern.weight;
        matched.push(pattern.label);
      }
    }
    // A single weak pattern is not enough to name a scheme.
    if (matched.length > 0 && (matched.length >= 2 || score >= 40)) {
      schemes.push({ id: scheme.id, score: clamp(score), matched });
    }
  }
  schemes.sort((a, b) => b.score - a.score);

  const signals: Signal[] = [];
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.re.test(norm)) signals.push({ text: pattern.label, weight: pattern.weight, source: "rules" });
  }
  if (obfuscated) {
    signals.push({ text: "Буквы в словах подменены латиницей — так обходят фильтры", weight: 20, source: "rules" });
  }
  return { schemes, signals, obfuscated };
}
