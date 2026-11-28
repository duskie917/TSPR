import type { CheckContext, DoneAction, Signal, Verdict } from "./types.ts";

export const CHANNEL_LABEL: Record<NonNullable<CheckContext["channel"]>, string> = {
  sms: "СМС",
  messenger: "мессенджер",
  call: "звонок",
  email: "e-mail",
  social: "соцсеть",
  other: "другое",
};

export const DONE_LABEL: Record<DoneAction, string> = {
  money: "перевели деньги",
  code: "назвали код или пароль",
  documents: "отправили документы или личные данные",
  link: "перешли по ссылке или ввели данные на сайте",
  app: "установили приложение или открыли файл",
};

/** What to do right now when the user has already acted. */
export const URGENT_STEPS: Record<DoneAction, string[]> = {
  money: [
    "Сразу позвоните в банк по номеру на карте или в приложении: попросите остановить перевод и заблокировать получателя. Счет идет на часы.",
    "Подайте заявление в милицию (102) и сохраните переписку, номера и чеки.",
  ],
  code: [
    "Срочно позвоните в банк и заблокируйте карту и вход в приложение.",
    "Смените пароли. В Telegram: Настройки → Устройства → завершите чужие сеансы и включите облачный пароль.",
    "Предупредите знакомых: от вашего имени могут просить деньги.",
  ],
  documents: [
    "Сообщите в свой банк, что документы могли попасть к мошенникам.",
    "Проверьте свою кредитную историю в кредитном бюро и следите за ней несколько месяцев.",
    "Если на вас оформят кредит или сим-карту — сразу подайте заявление в милицию (102).",
  ],
  link: [
    "Если вводили логин, пароль или данные карты — позвоните в банк и смените пароли.",
    "Не вводите на этом сайте больше ничего и закройте его.",
  ],
  app: [
    "Включите режим полета, чтобы программа не отправила ваши СМС.",
    "Позвоните в банк с другого телефона и заблокируйте карту.",
    "Удалите приложение, а лучше сбросьте телефон к заводским настройкам.",
  ],
};

/** Schemes where "I was expecting this" does not make the message any safer. */
const EXPECTATION_DOES_NOT_HELP = new Set([
  "bank_security_call", "sms_code_request", "police_impersonation", "relative_in_trouble", "fake_nbkr_credit",
  "phishing_site", "malicious_apk", "account_takeover", "hacked_friend_loan", "operator_sim",
]);

export interface ContextEffect {
  signals: Signal[];
  scoreDelta: number;
  /** How the context changed the assessment, shown to the user. */
  notes: string[];
  verify: string[];
}

export function applyContext(ctx: CheckContext | undefined, state: { score: number; schemeId: string; hasAction: boolean }): ContextEffect {
  const effect: ContextEffect = { signals: [], scoreDelta: 0, notes: [], verify: [] };
  if (!ctx) return effect;

  if (ctx.sender === "unknown" && state.hasAction) {
    effect.signals.push({ text: "Просьбу присылает незнакомый вам отправитель", weight: 10, source: "rules", stage: "trust" });
    effect.scoreDelta += 10;
    effect.notes.push("Отправитель вам незнаком — это повышает риск.");
  }
  if (ctx.sender === "known") {
    effect.notes.push("Вы знаете отправителя, но его аккаунт или номер могли взломать или подменить.");
    if (state.hasAction) effect.verify.push("Перезвоните этому человеку голосом по известному вам номеру и спросите, писал ли он.");
  }
  if (ctx.expected) {
    if (EXPECTATION_DOES_NOT_HELP.has(state.schemeId)) {
      effect.notes.push("Вы ждали похожего сообщения, но для этой схемы это не меняет оценку: мошенники пишут именно тем, кто чего-то ждет.");
    } else if (state.score > 0) {
      effect.scoreDelta -= 20;
      effect.notes.push("Вы сами подавали заявку или ждали этого сообщения — это немного снижает риск.");
      effect.verify.push("Сверьте, что сообщение пришло с того же сайта, адреса или номера, где вы подавали заявку.");
    }
  }
  if (ctx.channel === "call" && state.score >= 35) {
    effect.verify.push("Положите трубку и перезвоните в организацию сами по официальному номеру.");
  }
  if (ctx.done?.length) {
    effect.notes.push(`Вы уже ${ctx.done.map((d) => DONE_LABEL[d]).join(", ")}.`);
  }
  return effect;
}

/** Urgent steps for what the user already did; empty when nothing was done or nothing is wrong. */
export function urgentSteps(ctx: CheckContext | undefined, level: Verdict["level"]): Verdict["urgent"] {
  if (!ctx?.done?.length || level === "no_signs") return [];
  return ctx.done.map((d) => ({ action: d, title: `Вы ${DONE_LABEL[d]}`, steps: URGENT_STEPS[d] }));
}

/**
 * Reads context from the user's own words ("я уже скинул фото паспорта",
 * "это незнакомый номер", "я сама подавала заявку").
 */
export function parseContextNote(note: string): CheckContext {
  const t = note.toLowerCase().replace(/ё/g, "е");
  const ctx: CheckContext = { note: note.slice(0, 500) };
  const done = new Set<DoneAction>();
  if (/(перевел|перевела|отправил\p{L}* деньги|скинул\p{L}* деньги|оплатил|заплатил|перечислил)/u.test(t)) done.add("money");
  if (/(назвал\p{L}*|сказал\p{L}*|продиктовал\p{L}*|сообщил\p{L}*|ввел\p{L}*|отправил\p{L}*) (им |ему |ей )?(код|пароль|cvv)/u.test(t)) done.add("code");
  if (/(отправил\p{L}*|скинул\p{L}*|прислал\p{L}*|дал\p{L}*|сфотографировал\p{L}*) (им |ему |ей )?(фото |копию |скан )?(паспорт|документ|пин|инн|айди|id)/u.test(t)) done.add("documents");
  if (/(перешел|перешла|открыл\p{L}* ссылк|ввел\p{L}* (данные|карт|логин))/u.test(t)) done.add("link");
  if (/(установил\p{L}*|скачал\p{L}*|открыл\p{L}* файл)/u.test(t)) done.add("app");
  if (done.size) ctx.done = [...done];
  if (/(не знаю (этот|этого|эту|его|ее|их|отправител|кто)|незнаком|чужой номер|первый раз вижу|неизвестн\p{L}* номер)/u.test(t)) ctx.sender = "unknown";
  else if (/(это мой (друг|брат|сын|коллега)|это моя (подруга|сестра|дочь|мама)|знаю (его|ее)|знакомый)/u.test(t)) ctx.sender = "known";
  if (/(сам\p{L}* подавал\p{L}*|подавал\p{L}* заявку|я ждал\p{L}*|ожидал\p{L}*|регистрировал\p{L}*)/u.test(t)) ctx.expected = true;
  if (/(звонил\p{L}*|позвонил\p{L}*|по телефону)/u.test(t)) ctx.channel = "call";
  else if (/(смс|sms)/u.test(t)) ctx.channel = "sms";
  return ctx;
}

/** Merges a newer context into an older one (lists are unioned). */
export function mergeContext(a: CheckContext = {}, b: CheckContext = {}): CheckContext {
  const done = [...new Set([...(a.done ?? []), ...(b.done ?? [])])];
  return {
    channel: b.channel ?? a.channel,
    sender: b.sender ?? a.sender,
    expected: b.expected ?? a.expected,
    done: done.length ? done : undefined,
    note: [a.note, b.note].filter(Boolean).join("\n").slice(-1000) || undefined,
  };
}

/** One line for the AI prompt. */
export function describeContext(ctx: CheckContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.channel) parts.push(`канал: ${CHANNEL_LABEL[ctx.channel]}`);
  if (ctx.sender) parts.push(`отправитель: ${ctx.sender === "known" ? "знаком пользователю" : "незнаком пользователю"}`);
  if (ctx.expected) parts.push("пользователь ждал такого сообщения (сам подавал заявку)");
  if (ctx.done?.length) parts.push(`пользователь уже: ${ctx.done.map((d) => DONE_LABEL[d]).join(", ")}`);
  if (ctx.note) parts.push(`комментарий пользователя: ${ctx.note}`);
  return parts.join("; ");
}
