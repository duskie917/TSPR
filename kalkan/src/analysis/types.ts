import type { Stage } from "./schemes.ts";

export type { Stage };

/** 0–100. Higher means more likely to be fraud. */
export type RiskScore = number;

/**
 * Verdict levels. There is deliberately no "safe" level: the bot can only say
 * that it found no signs of fraud, never that something is safe.
 */
export type VerdictLevel = "danger" | "suspicious" | "no_signs";

export interface Signal {
  /** Short human-readable red flag, in Russian. */
  text: string;
  /** Contribution to the risk score. */
  weight: number;
  /** Where the signal came from. */
  source: "rules" | "url" | "phone" | "file" | "ai" | "reports" | "safe_browsing" | "virustotal";
  /** Which step of the manipulation this signal belongs to, when it is one. */
  stage?: Stage;
}

export interface SchemeMatch {
  id: string;
  score: RiskScore;
  matched: { label: string; stage: Stage }[];
}

export interface UrlFinding {
  url: string;
  host: string;
  score: RiskScore;
  signals: Signal[];
}

export interface PhoneFinding {
  raw: string;
  normalized: string;
  score: RiskScore;
  signals: Signal[];
}

export interface FileInfo {
  name?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
}

export interface AiAssessment {
  risk: "high" | "medium" | "low";
  schemeId: string;
  redFlags: string[];
  explanation: string;
  advice: string[];
}

export interface ReasoningStep {
  stage: Stage;
  title: string;
  /** Concrete evidence found in the message for this step. */
  items: string[];
}

export interface Reasoning {
  /** One or two sentences: what this looks like and how the scheme works. */
  summary: string;
  /** Manipulation steps found, in the order a scam unfolds. */
  chain: ReasoningStep[];
  /** Why the combination matters (or why nothing alarming was found). */
  conclusion: string;
  /** «На самом деле…» fact for the matched scheme. */
  reality?: string;
  /** Evidence outside the text: reports, Safe Browsing, VirusTotal, technical link details. */
  extra: string[];
}

export interface CheckInput {
  text?: string;
  /** Name of the chat/user a message was forwarded from, if any. */
  forwardedFrom?: string;
  file?: FileInfo;
  /** Base64 screenshot for AI vision. */
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  phone?: string;
}

export interface Verdict {
  level: VerdictLevel;
  score: RiskScore;
  /** Best-matching scheme id from the knowledge base, or "none"/"other". */
  schemeId: string;
  signals: Signal[];
  explanation?: string;
  /** Rule-based explanation of the logic behind the verdict. */
  reasoning: Reasoning;
  advice: string[];
  urls: UrlFinding[];
  phones: PhoneFinding[];
  aiUsed: boolean;
  /** Set when AI was requested but failed (network, refusal...). */
  aiError?: string;
}

export function levelFor(score: RiskScore): VerdictLevel {
  if (score >= 70) return "danger";
  if (score >= 35) return "suspicious";
  return "no_signs";
}

export const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
