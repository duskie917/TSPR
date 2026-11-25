import type { AiAnalyzer } from "./ai.ts";
import { buildReasoning } from "./explain.ts";
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

    // The link itself is the "dangerous request"; its technical details go to "extra".
    const linkSignals: Signal[] = urls.some((u) => u.score >= 35)
      ? [{ text: "Ведут на подозрительный сайт", weight: 0, source: "url", stage: "action" }]
      : [];

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
      extraSignals.push({ text: "«Официальная» организация пишет или звонит с иностранного номера", weight: 15, source: "phone", stage: "trust" });
      score = clamp(score + 15);
    }

    const signals: Signal[] = [
      ...rules.schemes.slice(0, 3).flatMap((s, i) =>
        s.matched.map((m) => ({ text: m.label, weight: i === 0 ? 30 : 20, source: "rules" as const, stage: m.stage, tag: m.tag })),
      ),
      ...rules.signals,
      ...extraSignals,
      ...linkSignals,
      ...urls.flatMap((u) => u.signals),
      ...phones.flatMap((p) => p.signals),
      ...fileSignals,
    ];

    // A forwarded warning about scammers is not a scam, unless it carries a risky
    // link, a reported/foreign number or a file.
    const awareness = rules.awareness && !urls.some((u) => u.score >= 35) && !phones.some((p) => p.score >= 35) && !input.file;
    if (awareness) {
      score = 0;
      for (const s of signals) {
        if (s.source === "rules") {
          s.stage = undefined;
          s.weight = 0;
        }
      }
      signals.length = 0;
      signals.push({ text: "Похоже на предупреждение о мошенниках, а не на само мошенничество: в тексте нет просьб к вам", weight: 0, source: "rules" });
    }

    // Combinations matter more than single words: a message can steal documents
    // without asking for money, codes or clicks. Count the manipulation steps that
    // have real evidence (weak hints such as a big name alone do not count).
    const stagesFound = new Set(signals.filter((s) => s.stage && (s.weight >= 10 || s.source === "url")).map((s) => s.stage));
    const actionFound = stagesFound.has("action");
    if (stagesFound.size >= 4) score = Math.max(score, 75);
    else if (stagesFound.size === 3 && actionFound) score = Math.max(score, 60);
    else if (stagesFound.size === 2 && actionFound) score = Math.max(score, 40);

    // 6. AI second opinion. It can raise the risk but never lower what the rules found:
    // a scam message may contain text designed to talk the model out of flagging it.
    let schemeId = topScheme?.id ?? "none";
    let explanation: string | undefined;
    let aiAdvice: string[] = [];
    let aiMissing: string[] = [];
    let aiVerify: string[] = [];
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
        aiMissing = ai.missing ?? [];
        aiVerify = ai.verify ?? [];
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
    if ((schemeId === "none" || schemeId === "other") && level !== "no_signs" && signals.some((s) => s.tag === "personal_data")) {
      schemeId = "data_harvest";
    }
    if (schemeId === "none" && level !== "no_signs") schemeId = "other";
    if (level === "no_signs") schemeId = "none";

    const schemeAdvice = SCHEME_BY_ID.get(schemeId)?.advice ?? [];
    // Scheme advice already covers "what if I already paid"; add only the general first rule to it.
    const fallback = schemeAdvice.length ? DEFAULT_ADVICE[level].slice(0, 1) : DEFAULT_ADVICE[level];
    const reasoning = buildReasoning({ level, schemeId, signals: dedupeSignals(signals) });
    if (level !== "no_signs") reasoning.missing = dedupe([...reasoning.missing, ...aiMissing]).slice(0, 4);
    reasoning.verify = dedupe([...reasoning.verify, ...aiVerify]).slice(0, 4);
    // Skip advice that only repeats the «На самом деле» fact.
    const repeatsReality = (a: string) => Boolean(reasoning.reality) && overlap(a, reasoning.reality!) >= 0.6;
    // ...and advice already listed under «Что проверить самостоятельно».
    const repeatsVerify = (a: string) => reasoning.verify.some((v) => overlap(a, v) >= 0.5);
    const advice = dedupe(aiAdvice.length ? aiAdvice : [...schemeAdvice.filter((a) => !repeatsReality(a)), ...fallback])
      .filter((a) => !repeatsVerify(a))
      .slice(0, 4);

    const finalSignals = dedupeSignals(signals).sort((a, b) => b.weight - a.weight);
    return {
      level,
      score,
      schemeId,
      signals: finalSignals,
      explanation,
      reasoning,
      advice,
      urls,
      phones,
      aiUsed,
      aiError,
    };
  }
}

/** Share of the first text's words that also appear in the second. */
function overlap(a: string, b: string): number {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.length ? wa.filter((w) => wb.has(w)).length / wa.length : 0;
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
