import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/analysis/engine.ts";
import { createBot } from "../src/bot/bot.ts";
import { Store } from "../src/storage/db.ts";

type Call = { method: string; payload: Record<string, unknown> };

function setup() {
  const store = new Store(":memory:");
  const engine = new Engine({ reports: store });
  const bot = createBot("123:TEST", { engine, store, aiEnabled: false }, {
    id: 1,
    is_bot: true,
    first_name: "Kalkan",
    username: "kalkan_test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as never);
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" } } : true } as never;
  });
  let updateId = 0;
  const from = (id: number, name: string) => ({ id, is_bot: false, first_name: name });
  const send = (userId: number, name: string, text: string, extra: Record<string, unknown> = {}) =>
    bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: userId, type: "private", first_name: name },
        from: from(userId, name),
        text,
        ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
        ...extra,
      },
    } as never);
  const press = (userId: number, name: string, data: string) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: String(updateId),
        from: from(userId, name),
        chat_instance: "x",
        data,
        message: { message_id: 1, date: 0, chat: { id: userId, type: "private" }, text: "x" },
      },
    } as never);
  const messagesTo = (chatId: number) =>
    calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === chatId).map((c) => String(c.payload.text));
  return { store, bot, calls, send, press, messagesTo };
}

test("forwarded scam gets a danger verdict with feedback buttons", async () => {
  const { send, messagesTo, calls } = setup();
  await send(10, "Айгуль", "Национальный банк: вам одобрен кредит, оплатите страховой взнос 3000 сом", {
    forward_origin: { type: "channel", date: 0, chat: { id: -100, type: "channel", title: "НБКР Кредит" }, message_id: 5 },
  });
  const reply = messagesTo(10).at(-1)!;
  assert.match(reply, /Очень похоже на мошенничество/);
  assert.match(reply, /Нацбанк/);
  const sent = calls.find((c) => c.method === "sendMessage")!;
  assert.match(JSON.stringify(sent.payload.reply_markup), /fb:\d+:1/);
});

test("family mode: guardian gets an alert without the message text", async () => {
  const { send, press, messagesTo, calls, store } = setup();
  await send(20, "Бакыт", "/start");
  await press(20, "Бакыт", "fam:invite");
  const invite = messagesTo(20).at(-1)!;
  const code = /start=fam_([A-Z0-9]+)/.exec(invite)?.[1];
  assert.ok(code, invite);

  await send(30, "Мама", `/start fam_${code}`);
  assert.match(messagesTo(30).at(-1)!, /Готово/);
  assert.match(messagesTo(20).at(-1)!, /Мама подключил/);
  assert.deepEqual(store.guardiansOf(30), [20]);

  const secret = "Служба безопасности банка: подозрительная операция, переведите деньги на безопасный счет";
  await send(30, "Мама", secret);
  const alert = messagesTo(20).at(-1)!;
  assert.match(alert, /Мама<\/b> только что проверил/);
  assert.ok(!alert.includes("безопасный счет"), "alert must not leak message text");

  // Benign message: no alert.
  const before = calls.length;
  await send(30, "Мама", "Купи хлеба по дороге домой");
  assert.equal(messagesTo(20).length, calls.slice(0, before).filter((c) => c.payload.chat_id === 20 && c.method === "sendMessage").length);
});

test("invite codes are single-use and not self-redeemable", async () => {
  const { send, press, messagesTo } = setup();
  await press(40, "A", "fam:invite");
  const code = /start=fam_([A-Z0-9]+)/.exec(messagesTo(40).at(-1)!)![1]!;
  await send(40, "A", `/join ${code}`);
  assert.match(messagesTo(40).at(-1)!, /собственный код/);
  await send(41, "B", `/join ${code}`);
  assert.match(messagesTo(41).at(-1)!, /Готово/);
  await send(42, "C", `/join ${code}`);
  assert.match(messagesTo(42).at(-1)!, /не найден/);
});

test("reports from users raise the risk of a number for others", async () => {
  const { send, messagesTo } = setup();
  for (const [id, name] of [[50, "a"], [51, "b"], [52, "c"]] as const) await send(id, name, "/report +996 555 000 777");
  assert.match(messagesTo(52).at(-1)!, /Жалоба принята \(3\)/);
  await send(53, "d", "Мне звонили с номера 0555 000 777");
  assert.match(messagesTo(53).at(-1)!, /Очень похоже на мошенничество|уже жаловались/);
});

test("APK document is flagged", async () => {
  const { bot, messagesTo } = setup();
  await bot.handleUpdate({
    update_id: 999,
    message: {
      message_id: 999,
      date: 0,
      chat: { id: 60, type: "private", first_name: "X" },
      from: { id: 60, is_bot: false, first_name: "X" },
      document: { file_id: "f", file_unique_id: "u", file_name: "Приглашение на той.apk", mime_type: "application/vnd.android.package-archive", file_size: 3_000_000 },
    },
  } as never);
  assert.match(messagesTo(60).at(-1)!, /Очень похоже на мошенничество/);
  assert.match(messagesTo(60).at(-1)!, /APK/);
});

test("context buttons and replies re-evaluate the verdict and alert family", async () => {
  const { send, press, messagesTo, calls, store } = setup();
  // Family link: 70 watches over 71.
  await press(70, "Внук", "fam:invite");
  const code = /start=fam_([A-Z0-9]+)/.exec(messagesTo(70).at(-1)!)![1]!;
  await send(71, "Бабушка", `/start fam_${code}`);

  await send(71, "Бабушка", "Вы прошли отбор на международную стажировку. Для регистрации пришлите копию паспорта, ответить нужно сегодня.");
  const verdict = calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === 71).at(-1)!;
  assert.match(String(verdict.payload.text), /Уточните кнопками/);
  const id = /dn:|cx:(\d+):known/.exec(JSON.stringify(verdict.payload.reply_markup))![1]!;
  assert.ok(store.getCheck(Number(id)));

  await press(71, "Бабушка", `dn:${id}:documents`);
  const edit = calls.filter((c) => c.method === "editMessageText").at(-1)!;
  assert.match(String(edit.payload.text), /Сделайте сейчас/);
  assert.match(messagesTo(70).at(-1)!, /уже отправили документы/);

  // A text reply to the verdict adds context instead of starting a new check.
  const before = calls.filter((c) => c.method === "editMessageText").length;
  await send(71, "Бабушка", "я еще и деньги перевела за регистрацию", {
    reply_to_message: { message_id: 1, date: 0, chat: { id: 71, type: "private" }, from: { id: 1, is_bot: true, first_name: "Kalkan" }, text: "Уровень риска" },
  });
  const edits = calls.filter((c) => c.method === "editMessageText");
  assert.equal(edits.length, before + 1);
  assert.match(String(edits.at(-1)!.payload.text), /перевели деньги/);
});
