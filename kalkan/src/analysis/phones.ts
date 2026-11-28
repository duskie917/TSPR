import { clamp, type PhoneFinding, type Signal } from "./types.ts";

const COUNTRY_CODES: [string, string][] = [
  ["996", "Кыргызстан"],
  ["998", "Узбекистан"],
  ["992", "Таджикистан"],
  ["993", "Туркменистан"],
  ["380", "Украина"],
  ["375", "Беларусь"],
  ["374", "Армения"],
  ["994", "Азербайджан"],
  ["995", "Грузия"],
  ["90", "Турция"],
  ["86", "Китай"],
  ["44", "Великобритания"],
  ["49", "Германия"],
  ["7", "Россия/Казахстан"],
  ["1", "США/Канада"],
];

/** Extracts phone-like sequences (9–15 digits). */
export function extractPhones(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![\w/.])\+?\d[\d\s()-]{7,18}\d(?![\w/])/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15) found.add(match[0].trim());
  }
  return [...found];
}

/** Normalizes to E.164 digits without "+". Local KG formats (0555 123 456, 555 123 456) become 996…. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `996${digits.slice(1)}`;
  else if (digits.length === 9 && !raw.trim().startsWith("+")) digits = `996${digits}`;
  return digits;
}

export function countryOf(normalized: string): string | undefined {
  return COUNTRY_CODES.find(([code]) => normalized.startsWith(code))?.[1];
}

/** Local heuristics. Community reports are added by the engine. */
export function analyzePhone(raw: string): PhoneFinding {
  const normalized = normalizePhone(raw);
  const signals: Signal[] = [];
  const add = (text: string, weight: number) => signals.push({ text, weight, source: "phone", stage: "trust" });

  if (normalized.startsWith("996")) {
    if (normalized.length !== 12) add("Номер в неправильном формате для Кыргызстана", 10);
  } else {
    const country = countryOf(normalized);
    add(
      country
        ? `Номер не кыргызстанский (${country})`
        : "Номер с иностранным или неизвестным кодом страны",
      15,
    );
  }
  return { raw, normalized, score: clamp(signals.reduce((s, x) => s + x.weight, 0)), signals };
}

export function formatPhone(normalized: string): string {
  if (normalized.startsWith("996") && normalized.length === 12) {
    return `+996 ${normalized.slice(3, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`;
  }
  return `+${normalized}`;
}
