import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { Message, User } from "grammy/types";
import type { BotConfig } from "grammy";
import { config, isAdmin } from "../config.ts";
import type { Engine } from "../analysis/engine.ts";
import { escapeHtml, formatVerdict, LEVEL_TITLE } from "../analysis/format.ts";
import { sha256 } from "../analysis/files.ts";
import { normalizePhone } from "../analysis/phones.ts";
import { schemeName } from "../analysis/schemes.ts";
import { mergeContext, parseContextNote } from "../analysis/context.ts";
import type { CheckContext, CheckInput, DoneAction, Verdict } from "../analysis/types.ts";
import { extractUrls, registrableDomain, toUrl } from "../analysis/urls.ts";
import type { Store } from "../storage/db.ts";
import { BUTTONS, T } from "./texts.ts";

const MAX_DOWNLOAD = 20 * 1024 * 1024; // Bot API getFile limit
const RATE_LIMIT = { max: 20, windowMs: 10 * 60_000 };
/** How long a checked message stays in memory so the user can add context. Never written to the database. */
const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 1000;

const DONE_BUTTONS: [DoneAction, string][] = [
  ["money", "💸 Перевел(а) деньги"],
  ["code", "🔢 Назвал(а) код"],
  ["documents", "🪪 Отправил(а) документы"],
  ["link", "🔗 Перешел(а) по ссылке"],
  ["app", "📲 Установил(а) приложение"],
];

interface Session {
  tgId: number;
  chatId: number;
  messageId: number;
  input: CheckInput;
  level: Verdict["level"];
  expires: number;
}

const mark = (on: boolean | undefined, label: string) => (on ? `✓ ${label}` : label);

function verdictKeyboard(id: number, s: Session | undefined, hasIndicators: boolean, menu: "main" | "done" = "main"): InlineKeyboard {
  const c = s?.input.context ?? {};
  const kb = new InlineKeyboard();
  if (menu === "done") {
    DONE_BUTTONS.forEach(([action, label], i) => {
      kb.text(mark(c.done?.includes(action), label), `dn:${id}:${action}`);
      if (i % 2 === 1) kb.row();
    });
    return kb.row().text("← Назад", `cx:${id}:back`);
  }
  kb.text("👍 Верно", `fb:${id}:1`).text("👎 Ошибка", `fb:${id}:-1`);
  if (hasIndicators) kb.row().text("🚩 Пожаловаться на мошенника", `rep:${id}`);
  if (s) {
    kb.row().text(mark(c.sender === "known", "👤 Знаю отправителя"), `cx:${id}:known`).text(mark(c.sender === "unknown", "❓ Незнакомый"), `cx:${id}:unknown`);
    kb.row().text(mark(c.expected, "📝 Я сам(а) ждал(а) это"), `cx:${id}:expected`).text(mark(Boolean(c.done?.length), "⚠️ Я уже ответил(а)"), `cx:${id}:done`);
  }
  return kb;
}

export interface BotDeps {
  engine: Engine;
  store: Store;
  aiEnabled: boolean;
  /** Downloads a Telegram file; replaceable in tests. */
  download?: (filePath: string) => Promise<Uint8Array>;
}

const mainMenu = new Keyboard().text(BUTTONS.family).text(BUTTONS.help).resized().persistent();

function displayName(user: User): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `id${user.id}`;
}

function forwardedFrom(msg: Message): string | undefined {
  const o = msg.forward_origin;
  if (!o) return undefined;
  switch (o.type) {
    case "user":
      return displayName(o.sender_user) + (o.sender_user.is_bot ? " (бот)" : "");
    case "hidden_user":
      return o.sender_user_name;
    case "chat":
      return o.sender_chat.title ?? "чат";
    case "channel":
      return `канал «${o.chat.title ?? ""}»`;
  }
}

export function createBot(token: string, deps: BotDeps, botInfo?: BotConfig<Context>["botInfo"]) {
  const { engine, store } = deps;
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const download =
    deps.download ??
    (async (filePath: string) => {
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const sessions = new Map<number, Session>();
  function remember(id: number, s: Session) {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(id, s);
  }
  function sessionFor(id: number, tgId: number): Session | undefined {
    const s = sessions.get(id);
    return s && s.tgId === tgId && s.expires > Date.now() ? s : undefined;
  }

  const hits = new Map<number, number[]>();
  function rateLimited(userId: number): boolean {
    if (isAdmin(userId)) return false;
    const now = Date.now();
    const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
    recent.push(now);
    hits.set(userId, recent);
    return recent.length > RATE_LIMIT.max;
  }

  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) store.upsertUser(ctx.from.id, displayName(ctx.from));
    await next();
  });

  // ---------- commands ----------
  bot.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("fam_")) return joinFamily(ctx, payload.slice(4));
    await ctx.reply(T.welcome(), { parse_mode: "HTML", reply_markup: mainMenu });
  });

  bot.command("help", (ctx) => ctx.reply(T.help(), { parse_mode: "HTML", reply_markup: mainMenu }));
  bot.command("privacy", (ctx) => ctx.reply(T.privacy(), { parse_mode: "HTML" }));
  bot.command("family", (ctx) => showFamily(ctx));
  bot.command("join", (ctx) => (ctx.match.trim() ? joinFamily(ctx, ctx.match.trim()) : ctx.reply(T.familyBadCode)));
  bot.hears(BUTTONS.family, (ctx) => showFamily(ctx));
  bot.hears(BUTTONS.help, (ctx) => ctx.reply(T.help(), { parse_mode: "HTML" }));

  bot.command("report", async (ctx) => {
    const arg = ctx.match.trim();
    if (!arg || !ctx.from) return ctx.reply(T.reportUsage, { parse_mode: "HTML" });
    const url = extractUrls(arg)[0];
    let added = false;
    let count = 0;
    if (url) {
      const domain = registrableDomain(toUrl(url).hostname);
      added = store.addReport("domain", domain, ctx.from.id);
      count = store.reportCount("domain", domain);
    } else {
      const phone = normalizePhone(arg);
      if (phone.length < 9) return ctx.reply(T.reportUsage, { parse_mode: "HTML" });
      added = store.addReport("phone", phone, ctx.from.id);
      count = store.reportCount("phone", phone);
    }
    await ctx.reply(added ? T.reportThanks(count) : T.reportDuplicate);
  });

  bot.command("stats", async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return;
    const s = store.stats(30);
    const schemes = s.topSchemes.map((x) => `• ${schemeName(x.schemeId) ?? x.schemeId}: ${x.count}`).join("\n") || "—";
    await ctx.reply(
      `<b>Статистика за 30 дней</b>\nПользователей: ${s.users}\nПроверок: 🔴 ${s.checks.danger ?? 0} · 🟠 ${s.checks.suspicious ?? 0} · 🟢 ${s.checks.no_signs ?? 0}\nСемейных связей: ${s.familyLinks}\nЖалоб: ${s.reports}\nОтзывы: 👍 ${s.feedback.correct} · 👎 ${s.feedback.wrong}\n\n<b>Топ схем:</b>\n${escapeHtml(schemes)}`,
      { parse_mode: "HTML" },
    );
  });

  // ---------- family mode ----------
  async function showFamily(ctx: Context) {
    if (!ctx.from) return;
    const name = (id: number) => escapeHtml(store.userName(id) ?? `id${id}`);
    const wards = store.wardsOf(ctx.from.id).map(name);
    const guardians = store.guardiansOf(ctx.from.id).map(name);
    const kb = new InlineKeyboard().text("➕ Пригласить родственника", "fam:invite");
    if (wards.length || guardians.length) kb.row().text("Отключить семейный режим", "fam:unlink");
    await ctx.reply(T.familyIntro(wards, guardians), { parse_mode: "HTML", reply_markup: kb });
  }

  async function joinFamily(ctx: Context, code: string) {
    if (!ctx.from) return;
    const result = store.redeemInvite(code, ctx.from.id);
    if ("error" in result) {
      await ctx.reply(result.error === "self" ? T.familySelf : T.familyBadCode, { reply_markup: mainMenu });
      return;
    }
    const guardian = escapeHtml(store.userName(result.guardianTgId) ?? "Ваш родственник");
    await ctx.reply(T.familyJoined(guardian), { parse_mode: "HTML", reply_markup: mainMenu });
    await ctx.api
      .sendMessage(result.guardianTgId, T.familyGuardianNotified(escapeHtml(displayName(ctx.from))))
      .catch(() => {});
  }

  bot.callbackQuery("fam:invite", async (ctx) => {
    const code = store.createInvite(ctx.from.id);
    const link = `https://t.me/${ctx.me.username}?start=fam_${code}`;
    await ctx.answerCallbackQuery();
    await ctx.reply(T.familyInvite(link, code), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.callbackQuery("fam:unlink", async (ctx) => {
    const n = store.unlinkAll(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.reply(T.familyUnlinked(n));
  });

  // ---------- feedback & reports from a verdict ----------
  bot.callbackQuery(/^fb:(\d+):(1|-1)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    store.setFeedback(id, ctx.from.id, ctx.match[2] === "1" ? 1 : -1);
    await ctx.answerCallbackQuery({ text: T.feedbackThanks });
    const row = store.getCheck(id);
    const ind = row ? (JSON.parse(row.indicators) as { phones: string[]; domains: string[] }) : { phones: [], domains: [] };
    const full = verdictKeyboard(id, sessionFor(id, ctx.from.id), ind.phones.length + ind.domains.length > 0);
    // Feedback buttons disappear once used; keep the rest.
    const kb = new InlineKeyboard(full.inline_keyboard.filter((r) => !r.some((b) => "callback_data" in b && b.callback_data.startsWith("fb:"))));
    await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
  });

  bot.callbackQuery(/^rep:(\d+)$/, async (ctx) => {
    const row = store.getCheck(Number(ctx.match[1]));
    if (!row || row.tg_id !== ctx.from.id) return ctx.answerCallbackQuery();
    const ind = JSON.parse(row.indicators) as { phones: string[]; domains: string[] };
    let added = 0;
    for (const p of ind.phones) if (store.addReport("phone", p, ctx.from.id)) added++;
    for (const d of ind.domains) if (store.addReport("domain", d, ctx.from.id)) added++;
    await ctx.answerCallbackQuery({ text: added ? "Жалоба отправлена. Спасибо!" : T.reportDuplicate });
  });

  // ---------- checks ----------
  async function runCheck(ctx: Context, input: CheckInput, kind: string, existing?: { id: number; session: Session }) {
    if (!ctx.from || !ctx.chat) return;
    if (rateLimited(ctx.from.id)) return void (await ctx.reply(T.rateLimited));
    await ctx.replyWithChatAction("typing").catch(() => {});

    let verdict: Verdict;
    try {
      verdict = await engine.check(input);
    } catch (err) {
      console.error("check failed", err);
      return void (await ctx.reply(T.error));
    }

    const indicators = {
      phones: verdict.phones.map((p) => p.normalized),
      domains: [...new Set(verdict.urls.map((u) => registrableDomain(u.host)))],
    };
    const hasIndicators = indicators.phones.length + indicators.domains.length > 0;
    const text = `${formatVerdict(verdict)}\n\n<i>${T.contextHint}</i>`;
    const previous = existing?.session;

    let id: number;
    let messageId: number;
    if (existing) {
      id = existing.id;
      messageId = existing.session.messageId;
      store.updateCheck(id, { level: verdict.level, score: verdict.score, schemeId: verdict.schemeId });
    } else {
      id = store.logCheck({ tgId: ctx.from.id, kind, level: verdict.level, score: verdict.score, schemeId: verdict.schemeId, indicators });
      messageId = 0;
    }
    const session: Session = { tgId: ctx.from.id, chatId: ctx.chat.id, messageId, input, level: verdict.level, expires: Date.now() + SESSION_TTL_MS };
    const kb = verdictKeyboard(id, session, hasIndicators);

    if (existing) {
      await ctx.api
        .editMessageText(session.chatId, messageId, text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } })
        .catch(() => {});
    } else {
      const sent = await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: kb,
        link_preview_options: { is_disabled: true },
        reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id, allow_sending_without_reply: true } : undefined,
      });
      session.messageId = sent.message_id;
    }
    remember(id, session);

    // Family alerts: on a new risky verdict, and again when the user says they already acted.
    const newDone = (input.context?.done ?? []).filter((d) => !previous?.input.context?.done?.includes(d));
    const becameRisky = verdict.level !== "no_signs" && (!previous || previous.level === "no_signs");
    if (verdict.level !== "no_signs" && (becameRisky || newDone.length)) {
      const ward = escapeHtml(displayName(ctx.from));
      const scheme = schemeName(verdict.schemeId);
      const msg = newDone.length && verdict.urgent.length
        ? T.familyUrgent(ward, verdict.urgent.filter((u) => newDone.includes(u.action)).map((u) => escapeHtml(u.title.replace(/^Вы /, ""))))
        : T.familyAlert(ward, LEVEL_TITLE[verdict.level], scheme && escapeHtml(scheme));
      for (const guardian of store.guardiansOf(ctx.from.id)) {
        await ctx.api.sendMessage(guardian, msg, { parse_mode: "HTML" }).catch((err) => console.error("family alert failed", err));
      }
    }
  }

  /** Re-runs a recent check with more context from the user. */
  async function recheck(ctx: Context, id: number, update: (c: CheckContext) => CheckContext) {
    if (!ctx.from) return false;
    const session = sessionFor(id, ctx.from.id);
    if (!session) return false;
    const input = { ...session.input, context: update({ ...(session.input.context ?? {}) }) };
    await runCheck(ctx, input, "recheck", { id, session });
    return true;
  }

  bot.callbackQuery(/^cx:(\d+):(known|unknown|expected|done|back)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const key = ctx.match[2];
    const session = sessionFor(id, ctx.from.id);
    if (!session) return ctx.answerCallbackQuery({ text: T.contextExpired, show_alert: true });
    if (key === "done" || key === "back") {
      await ctx.answerCallbackQuery();
      const row = store.getCheck(id);
      const ind = row ? (JSON.parse(row.indicators) as { phones: string[]; domains: string[] }) : { phones: [], domains: [] };
      await ctx.editMessageReplyMarkup({ reply_markup: verdictKeyboard(id, session, ind.phones.length + ind.domains.length > 0, key === "done" ? "done" : "main") }).catch(() => {});
      return;
    }
    await ctx.answerCallbackQuery({ text: T.contextUpdated });
    await recheck(ctx, id, (c) => {
      if (key === "expected") c.expected = !c.expected;
      else c.sender = c.sender === key ? undefined : (key as "known" | "unknown");
      return c;
    });
  });

  bot.callbackQuery(/^dn:(\d+):(money|code|documents|link|app)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const action = ctx.match[2] as DoneAction;
    await ctx.answerCallbackQuery({ text: T.contextUpdated });
    const ok = await recheck(ctx, id, (c) => {
      const done = new Set(c.done ?? []);
      if (done.has(action)) done.delete(action);
      else done.add(action);
      c.done = done.size ? [...done] : undefined;
      return c;
    });
    if (!ok) await ctx.reply(T.contextExpired);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.msg.text.startsWith("/")) return; // unknown command
    // A reply to one of our verdicts is context for that check, not a new message to check.
    const repliedTo = ctx.msg.reply_to_message;
    if (repliedTo?.from?.id === ctx.me.id) {
      const entry = [...sessions.entries()].find(([, s]) => s.messageId === repliedTo.message_id && s.tgId === ctx.from.id);
      if (entry) {
        const added = parseContextNote(ctx.msg.text);
        await recheck(ctx, entry[0], (c) => mergeContext(c, added));
        return;
      }
      if (repliedTo.text && /Уровень риска/.test(repliedTo.text)) return void (await ctx.reply(T.contextExpired));
    }
    await runCheck(ctx, { text: ctx.msg.text, forwardedFrom: forwardedFrom(ctx.msg) }, "text");
  });

  bot.on("message:contact", async (ctx) => {
    await runCheck(ctx, { phone: ctx.msg.contact.phone_number }, "phone");
  });

  bot.on("message:photo", async (ctx) => {
    const caption = ctx.msg.caption;
    if (!deps.aiEnabled) {
      if (!caption) return void (await ctx.reply(T.photoNoAi));
      return runCheck(ctx, { text: caption, forwardedFrom: forwardedFrom(ctx.msg) }, "photo");
    }
    const photo = ctx.msg.photo[ctx.msg.photo.length - 1]!;
    let image: CheckInput["image"];
    try {
      const file = await ctx.api.getFile(photo.file_id);
      if (file.file_path) image = { data: Buffer.from(await download(file.file_path)).toString("base64"), mediaType: "image/jpeg" };
    } catch (err) {
      console.error("photo download failed", err);
    }
    if (!image && !caption) return void (await ctx.reply(T.error));
    await runCheck(ctx, { text: caption, image, forwardedFrom: forwardedFrom(ctx.msg) }, "photo");
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.msg.document;
    const input: CheckInput = {
      text: ctx.msg.caption,
      forwardedFrom: forwardedFrom(ctx.msg),
      file: { name: doc.file_name, mimeType: doc.mime_type, size: doc.file_size },
    };
    const isImage = /^image\/(jpeg|png|webp)$/.test(doc.mime_type ?? "");
    const wantBytes = (config.virusTotalKey || (isImage && deps.aiEnabled)) && (doc.file_size ?? 0) <= MAX_DOWNLOAD;
    if (wantBytes) {
      try {
        const file = await ctx.api.getFile(doc.file_id);
        if (file.file_path) {
          const bytes = await download(file.file_path);
          input.file!.sha256 = sha256(bytes);
          if (isImage && deps.aiEnabled) {
            input.image = { data: Buffer.from(bytes).toString("base64"), mediaType: doc.mime_type as "image/jpeg" | "image/png" | "image/webp" };
          }
        }
      } catch (err) {
        console.error("document download failed", err);
      }
    } else if ((doc.file_size ?? 0) > MAX_DOWNLOAD && config.virusTotalKey) {
      await ctx.reply(T.fileTooBig);
    }
    await runCheck(ctx, input, "file");
  });

  bot.on("message", (ctx) => ctx.reply(T.nothingToCheck));

  bot.catch((err) => console.error("bot error", err.error));
  return bot;
}


