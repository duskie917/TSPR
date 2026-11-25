import { SCHEME_BY_ID } from "./schemes.ts";
import type { Reasoning, ReasoningStep, Signal, Stage, VerdictLevel } from "./types.ts";

/** Steps in the order a scam unfolds. */
export const STAGE_ORDER: Stage[] = ["trust", "bait", "urgency", "action"];

export const STAGE_TITLE: Record<Stage, string> = {
  trust: "Доверие",
  bait: "Страх или выгода",
  urgency: "Давление",
  action: "Опасная просьба",
};

export const STAGE_HINT: Record<Stage, string> = {
  trust: "выдают себя за того, кому вы верите",
  bait: "пугают бедой или обещают деньги",
  urgency: "торопят или требуют секретности",
  action: "просят деньги, код, данные, ссылку или файл",
};

const MAX_ITEMS_PER_STEP = 3;

/**
 * Turns the found signals into an explanation of the logic: which steps of a
 * typical manipulation the message contains and why that combination matters.
 */
export function buildReasoning(args: { level: VerdictLevel; schemeId: string; signals: Signal[] }): Reasoning {
  const { level, schemeId, signals } = args;
  const scheme = SCHEME_BY_ID.get(schemeId);

  const chain: ReasoningStep[] = [];
  for (const stage of STAGE_ORDER) {
    const items = [...new Set(signals.filter((s) => s.stage === stage).map((s) => s.text))].slice(0, MAX_ITEMS_PER_STEP);
    if (items.length) chain.push({ stage, title: STAGE_TITLE[stage], items });
  }
  const extra = [...new Set(signals.filter((s) => !s.stage).map((s) => s.text))].slice(0, 4);

  const n = chain.length;
  const hasAction = chain.some((c) => c.stage === "action");

  let summary: string;
  if (level === "no_signs") summary = "В сообщении нет признаков известных мошеннических схем.";
  else if (scheme) summary = `Сообщение похоже на схему ${scheme.name.startsWith("«") ? scheme.name : `«${scheme.name}»`}. ${scheme.howItWorks}`;
  else summary = "Сообщение не совпадает целиком ни с одной известной схемой, но в нем есть приемы, которыми пользуются мошенники.";

  let conclusion: string;
  if (level === "no_signs") {
    conclusion =
      n === 0
        ? "Никто не выдает себя за организацию, не торопит и не просит денег, кодов или перехода по ссылке — главных приемов манипуляции нет."
        : `${n === 1 ? "Есть отдельный признак" : "Есть отдельные признаки"} (${chain.map((c) => c.title.toLowerCase()).join(", ")}), но вместе они не складываются в мошенническую схему. Если дальше попросят деньги или код — проверьте сообщение снова.`;
  } else if (n >= 3 && hasAction) {
    conclusion = `${n === 4 ? "Здесь есть все 4 шага" : `Здесь ${n} из 4 шагов`} типичной манипуляции: вас сначала убеждают, затем давят и в конце просят опасное действие. Такое сочетание почти всегда означает обман.`;
  } else if (n === 2 && hasAction) {
    conclusion = "Здесь 2 из 4 шагов манипуляции, и один из них — опасная просьба (деньги, код, данные, ссылка или файл). Этого достаточно, чтобы остановиться и перепроверить.";
  } else if (hasAction) {
    conclusion = "Главный тревожный признак — опасная просьба: деньги, код, данные, ссылка или файл. От незнакомых такие просьбы всегда нужно перепроверять.";
  } else {
    conclusion = "Прямой просьбы о деньгах или кодах пока нет, но так обычно начинается схема: следующим шагом попросят перевести деньги, назвать код или перейти по ссылке.";
  }

  return {
    summary,
    chain,
    conclusion,
    reality: level !== "no_signs" ? scheme?.reality : undefined,
    extra,
  };
}
