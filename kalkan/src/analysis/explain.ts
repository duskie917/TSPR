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

/** What the step is and why it matters. */
export const STAGE_HINT: Record<Stage, string> = {
  trust: "выдают себя за того, кому вы верите, чтобы вы не перепроверяли",
  bait: "пугают или обещают выгоду: сильные эмоции мешают думать",
  urgency: "торопят или требуют секретности, чтобы не было времени проверить",
  action: "то, ради чего все затеяно: деньги, код, документы, ссылка или файл",
};

const MAX_ITEMS_PER_STEP = 3;

/**
 * Intent and harm, inferred from what the message asks the user to do.
 * Order matters: the first matching rule wins for each signal.
 */
const INTENTS: { test: (s: Signal) => boolean; goal: string; harm: string }[] = [
  {
    test: (s) => s.tag === "personal_data" || /паспорт|документ|личные данные/i.test(s.text),
    goal: "получить ваш паспорт и личные данные",
    harm: "На ваше имя могут оформить кредит, сим-карту или фирму-однодневку, а сами документы — продать.",
  },
  {
    test: (s) => /переводы на вашу карту/i.test(s.text),
    goal: "использовать вашу карту для чужих денег",
    harm: "Владельцев таких карт (дропов) привлекают к уголовной ответственности.",
  },
  {
    test: (s) => /код|пароль/i.test(s.text),
    goal: "получить код или пароль",
    harm: "Войдут в ваш банк или мессенджер и от вашего имени обманут ваших знакомых.",
  },
  {
    test: (s) => /карт|cvv/i.test(s.text) && !/на карту/i.test(s.text),
    goal: "получить данные вашей карты",
    harm: "С карты спишут деньги.",
  },
  {
    test: (s) => /apk|приложени|файл|программ/i.test(s.text),
    goal: "установить вредоносную программу",
    harm: "Программа прочитает СМС с кодами и даст доступ к вашему банку.",
  },
  {
    test: (s) => /сайт|ссылк/i.test(s.text),
    goal: "заманить на поддельный сайт",
    harm: "Все, что вы введете на сайте — логин, пароль, данные карты, — попадет к мошенникам.",
  },
  {
    test: (s) => /перев|заплат|оплат|деньг|займ|занять|предоплат|депозит|взнос|счет/i.test(s.text),
    goal: "получить ваши деньги",
    harm: "Перевод почти невозможно вернуть.",
  },
];

/**
 * Turns the found signals into an explanation of the logic: which steps of a
 * typical manipulation the message contains, why that combination matters,
 * what the sender is after, what is missing and what to verify.
 */
export function buildReasoning(args: { level: VerdictLevel; schemeId: string; signals: Signal[] }): Reasoning {
  const { level, schemeId, signals } = args;
  const scheme = SCHEME_BY_ID.get(schemeId);
  const has = (tag: Signal["tag"]) => signals.some((s) => s.tag === tag);

  const chain: ReasoningStep[] = [];
  for (const stage of STAGE_ORDER) {
    const items = [...new Set(signals.filter((s) => s.stage === stage).map((s) => s.text))].slice(0, MAX_ITEMS_PER_STEP);
    if (items.length) chain.push({ stage, title: STAGE_TITLE[stage], items });
  }
  const extra = [...new Set(signals.filter((s) => !s.stage && s.tag !== "legit_channel").map((s) => s.text))].slice(0, 4);

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
        ? "Никто не выдает себя за организацию, не торопит и не просит денег, кодов, документов или перехода по ссылке — главных приемов манипуляции нет."
        : `${n === 1 ? "Есть отдельный признак" : "Есть отдельные признаки"} (${chain.map((c) => c.title.toLowerCase()).join(", ")}), но вместе они не складываются в мошенническую схему. Если дальше попросят деньги, код или документы — проверьте сообщение снова.`;
  } else if (n >= 3 && hasAction) {
    conclusion = `${n === 4 ? "Здесь есть все 4 шага" : `Здесь ${n} из 4 шагов`} типичной манипуляции: вас сначала убеждают, затем давят и в конце просят опасное действие. Даже без просьбы о деньгах такое сочетание — серьезный повод остановиться.`;
  } else if (n === 2 && hasAction) {
    conclusion = "Здесь 2 из 4 шагов манипуляции, и один из них — опасная просьба (деньги, код, документы, ссылка или файл). Этого достаточно, чтобы остановиться и перепроверить.";
  } else if (hasAction) {
    conclusion = "Главный тревожный признак — опасная просьба: деньги, код, документы, ссылка или файл. От незнакомых такие просьбы всегда нужно перепроверять.";
  } else {
    conclusion = "Прямой опасной просьбы пока нет, но так обычно начинается схема: следующим шагом просят деньги, код, документы или перейти по ссылке.";
  }

  // Intent & harm: what happens if the user does what is asked.
  const intent: Reasoning["intent"] = [];
  if (level !== "no_signs") {
    for (const s of signals.filter((x) => x.stage === "action")) {
      const rule = INTENTS.find((r) => r.test(s));
      if (rule && !intent.some((i) => i.goal === rule.goal)) intent.push({ goal: rule.goal, harm: rule.harm });
    }
  }

  // Missing information a legitimate sender would give.
  const missing: string[] = [];
  if (level !== "no_signs") {
    if (has("unverified_org")) missing.push("Название организатора, официальный сайт и контакты, по которым его можно проверить");
    if (has("referral")) missing.push("Имя того, кто передал ваш контакт, — чтобы вы могли у него уточнить");
    if (has("personal_data")) missing.push("Зачем нужны документы и как они будут защищены (официальная форма, договор, политика данных)");
    if (has("opportunity")) missing.push("Ссылка на публичное объявление о программе и условия отбора");
    if (has("urgency")) missing.push("Разумный срок на ответ — настоящие организаторы его дают");
  }

  // What to verify independently.
  const verify: string[] = [];
  {
    if (has("unverified_org") || has("opportunity") || has("authority")) {
      verify.push("Найдите организатора сами (через поиск, а не по ссылке из сообщения) и спросите по официальным контактам, приглашали ли вас.");
    }
    if (has("referral")) verify.push("Спросите у коллег или знакомых напрямую, передавали ли они ваш контакт.");
    if (has("personal_data")) verify.push("Не отправляйте паспорт, ПИН и фото документов, пока не убедитесь, что отправитель настоящий.");
    if (has("urgency")) verify.push("Не спешите: срок «ответить сегодня» — прием давления, а не правило.");
    if (verify.length === 0 && level !== "no_signs" && chain.some((c) => c.stage === "trust")) {
      verify.push("Свяжитесь с организацией или человеком сами — по номеру с официального сайта или по старому, известному вам номеру.");
    }
  }

  return {
    summary,
    chain,
    conclusion,
    reality: level !== "no_signs" ? scheme?.reality : undefined,
    extra,
    intent: intent.slice(0, 2),
    missing: missing.slice(0, 4),
    verify: verify.slice(0, 4),
  };
}
