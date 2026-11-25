import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { Message, User } from "grammy/types";
import type { BotConfig } from "grammy";
import { config, isAdmin } from "../config.ts";
import type { Engine } from "../analysis/engine.ts";
import { escapeHtml, formatVerdict, LEVEL_TITLE } from "../analysis/format.ts";
import { sha256 } from "../analysis/files.ts";
import { normalizePhone } from "../analysis/phones.ts";
import { schemeName } from "../analysis/schemes.ts";
import type { CheckInput, Verdict } from "../analysis/types.ts";
import { extractUrls, registrableDomain, toUrl } from "../analysis/urls.ts";
import type { Store } from "../storage/db.ts";
import { BUTTONS, T } from "./texts.ts";

const MAX_DOWNLOAD = 20 * 1024 * 1024; // Bot API getFile limit
const RATE_LIMIT = { max: 20, windowMs: 10 * 60_000 };

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
    await ctx.editMessageReplyMarkup({ reply_markup: reportKeyboard(id, store) }).catch(() => {});
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
  async function runCheck(ctx: Context, input: CheckInput, kind: string) {
    if (!ctx.from) return;
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
    const id = store.logCheck({ tgId: ctx.from.id, kind, level: verdict.level, score: verdict.score, schemeId: verdict.schemeId, indicators });

    const kb = new InlineKeyboard().text("👍 Верно", `fb:${id}:1`).text("👎 Ошибка", `fb:${id}:-1`);
    if (indicators.phones.length || indicators.domains.length) kb.row().text("🚩 Пожаловаться на мошенника", `rep:${id}`);
    await ctx.reply(formatVerdict(verdict), {
      parse_mode: "HTML",
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
      reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id, allow_sending_without_reply: true } : undefined,
    });

    if (verdict.level !== "no_signs") {
      const ward = escapeHtml(displayName(ctx.from));
      const scheme = schemeName(verdict.schemeId);
      for (const guardian of store.guardiansOf(ctx.from.id)) {
        await ctx.api
          .sendMessage(guardian, T.familyAlert(ward, LEVEL_TITLE[verdict.level], scheme && escapeHtml(scheme)), { parse_mode: "HTML" })
          .catch((err) => console.error("family alert failed", err));
      }
    }
  }

  bot.on("message:text", async (ctx) => {
    if (ctx.msg.text.startsWith("/")) return; // unknown command
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

function reportKeyboard(id: number, store: Store): InlineKeyboard {
  const row = store.getCheck(id);
  const kb = new InlineKeyboard();
  if (!row) return kb;
  const ind = JSON.parse(row.indicators) as { phones: string[]; domains: string[] };
  if (ind.phones.length || ind.domains.length) kb.text("🚩 Пожаловаться на мошенника", `rep:${id}`);
  return kb;
}

