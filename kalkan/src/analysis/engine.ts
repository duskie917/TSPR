import type { AiAnalyzer } from "./ai.ts";
import { analyzeFile, virusTotalLookup } from "./files.ts";
import { analyzePhone, extractPhones } from "./phones.ts";
import { analyzeRules } from "./rules.ts";
import { SCHEME_BY_ID } from "./schemes.ts";
import { analyzeUrl, extractUrls, registrableDomain, safeBrowsingLookup } from "./urls.ts";
import { clamp, levelFor, type CheckInput, type Signal, type Verdict } from "./types.ts";

export interface ReportsLookup {
  reportCount(kind: "phone" | "domain", value: string): number;
}

export interface EngineOptions {
  ai?: AiAnalyzer;
  reports?: ReportsLookup;
  safeBrowsingKey?: string;
  virusTotalKey?: string;
  log?: (msg: string, err?: unknown) => void;
}

const AI_RISK_SCORE = { high: 85, medium: 55, low: 15 } as const;

const DEFAULT_ADVICE: Record<Verdict["level"], string[]> = {
  danger: [
    "Не переходите по ссылкам, не переводите деньги и не называйте коды.",
    "Если уже сообщили данные карты или код — срочно позвоните в банк и заблокируйте карту.",
  ],
  suspicious: [
    "Не торопитесь: мошенники всегда давят срочностью.",
    "Проверьте информацию, позвонив в организацию по официальному номеру (с сайта или с обратной стороны карты).",
  ],
  no_signs: [
    "Явных признаков мошенничества не найдено, но это не гарантия безопасности.",
    "Если вас просят перевести деньги или назвать код — остановитесь и перепроверьте.",
  ],
};

function reportWeight(count: number): number {
  if (count >= 3) return 70;
  if (count === 2) return 50;
  return count === 1 ? 30 : 0;
}

export class Engine {
  constructor(private opts: EngineOptions = {}) {}

  async check(input: CheckInput): Promise<Verdict> {
    const log = this.opts.log ?? (() => {});
    const text = [input.forwardedFrom ? `Переслано от: ${input.forwardedFrom}` : "", input.text ?? "", input.file?.name ?? ""]
      .filter(Boolean)
      .join("\n");

    // 1. Text rules.
    const rules = analyzeRules(text);
    const topScheme = rules.schemes[0];

    // 2. Links.
    const urls = extractUrls(text).slice(0, 10).map(analyzeUrl);
    for (const u of urls) {
      const count = this.opts.reports?.reportCount("domain", registrableDomain(u.host)) ?? 0;
      if (count > 0) {
        u.signals.push({ text: `На этот сайт уже жаловались пользователи (${count})`, weight: reportWeight(count), source: "reports" });
        u.score = clamp(u.score + reportWeight(count));
      }
    }
    if (this.opts.safeBrowsingKey && urls.length > 0) {
      try {
        const flagged = await safeBrowsingLookup(urls.map((u) => u.url), this.opts.safeBrowsingKey);
        for (const u of urls) {
          if (flagged.has(u.url)) {
            u.signals.push({ text: "Google Safe Browsing: сайт в базе опасных (фишинг/вирусы)", weight: 90, source: "safe_browsing" });
            u.score = clamp(u.score + 90);
          }
        }
      } catch (err) {
        log("safe browsing failed", err);
      }
    }

    // 3. Phone numbers.
    const rawPhones = [...extractPhones(input.text ?? ""), ...(input.phone ? [input.phone] : [])];
    const phones = [...new Map(rawPhones.map((p) => analyzePhone(p)).map((p) => [p.normalized, p])).values()].slice(0, 5);
    for (const ph of phones) {
      const count = this.opts.reports?.reportCount("phone", ph.normalized) ?? 0;
      if (count > 0) {
        ph.signals.push({ text: `На этот номер уже жаловались пользователи (${count})`, weight: reportWeight(count), source: "reports" });
        ph.score = clamp(ph.score + reportWeight(count));
      }
    }

    // 4. File.
    const fileSignals: Signal[] = [];
    let fileScore = 0;
    if (input.file) {
      const f = analyzeFile(input.file);
      fileSignals.push(...f.signals);
      fileScore = f.score;
      if (input.file.sha256 && this.opts.virusTotalKey) {
        try {
          const vt = await virusTotalLookup(input.file.sha256, this.opts.virusTotalKey);
          if (vt?.known && vt.malicious + vt.suspicious > 0) {
            fileSignals.push({
              text: `VirusTotal: ${vt.malicious + vt.suspicious} из ${vt.total} антивирусов считают файл вредоносным`,
              weight: 90,
              source: "virustotal",
            });
            fileScore = clamp(fileScore + 90);
          }
        } catch (err) {
          log("virustotal failed", err);
        }
      }
    }

    // 5. Combine heuristics: strongest component + a share of the rest.
    const components = [
      topScheme?.score ?? 0,
      ...urls.map((u) => u.score),
      ...phones.map((p) => p.score),
      fileScore,
    ].sort((a, b) => b - a);
    const genericBonus = rules.signals.reduce((s, x) => s + x.weight, 0);
    let score = clamp((components[0] ?? 0) + 0.25 * (components[1] ?? 0) + genericBonus);

    // Foreign number + bank/state context is a strong combination.
    const officialContext = topScheme && ["fake_nbkr_credit", "bank_security_call", "police_impersonation", "state_payout"].includes(topScheme.id);
    const extraSignals: Signal[] = [];
    if (officialContext && phones.some((p) => !p.normalized.startsWith("996"))) {
      extraSignals.push({ text: "«Официальная» организация с иностранного номера", weight: 15, source: "phone" });
      score = clamp(score + 15);
    }

    const signals: Signal[] = [
      ...(topScheme?.matched.map((t) => ({ text: t, weight: 30, source: "rules" as const })) ?? []),
      ...rules.signals,
      ...extraSignals,
      ...urls.flatMap((u) => u.signals),
      ...phones.flatMap((p) => p.signals),
      ...fileSignals,
    ];

    // 6. AI second opinion. It can raise the risk but never lower what the rules found:
    // a scam message may contain text designed to talk the model out of flagging it.
    let schemeId = topScheme?.id ?? "none";
    let explanation: string | undefined;
    let aiAdvice: string[] = [];
    let aiUsed = false;
    let aiError: string | undefined;
    const hasContent = Boolean(input.text?.trim() || input.image || input.file || input.phone);
    if (this.opts.ai && hasContent) {
      try {
        const findings = signals.map((s) => `- [${s.source}] ${s.text}`).join("\n");
        const ai = await this.opts.ai.assess(input, findings);
        aiUsed = true;
        score = Math.max(score, AI_RISK_SCORE[ai.risk]);
        if (ai.schemeId !== "none" && (!topScheme || topScheme.score < 60)) schemeId = ai.schemeId;
        explanation = ai.explanation;
        aiAdvice = ai.advice;
        const known = new Set(signals.map((s) => s.text.toLowerCase()));
        for (const flag of ai.redFlags) {
          if (!known.has(flag.toLowerCase())) signals.push({ text: flag, weight: 20, source: "ai" });
        }
      } catch (err) {
        aiError = err instanceof Error ? err.message : String(err);
        log("ai failed", err);
      }
    }

    const level = levelFor(score);
    if ((schemeId === "none" || schemeId === "other") && level !== "no_signs" && urls.some((u) => u.score >= 60)) {
      schemeId = "phishing_site";
    }
    if (schemeId === "none" && level !== "no_signs") schemeId = "other";
    if (level === "no_signs") schemeId = "none";

    const schemeAdvice = SCHEME_BY_ID.get(schemeId)?.advice ?? [];
    // Scheme advice already covers "what if I already paid"; add only the general first rule to it.
    const fallback = schemeAdvice.length ? DEFAULT_ADVICE[level].slice(0, 1) : DEFAULT_ADVICE[level];
    const advice = dedupe(aiAdvice.length ? aiAdvice : [...schemeAdvice, ...fallback]).slice(0, 4);

    return {
      level,
      score,
      schemeId,
      signals: dedupeSignals(signals).sort((a, b) => b.weight - a.weight),
      explanation,
      advice,
      urls,
      phones,
      aiUsed,
      aiError,
    };
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = s.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
