import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/analysis/engine.ts";
import { mergeContext, parseContextNote } from "../src/analysis/context.ts";

const engine = new Engine();
const FORUM =
  "Здравствуйте! Ваш контакт нам передали коллеги. Приглашаем вас принять участие в Международном молодежном форуме лидеров в Стамбуле. Участие бесплатное, организаторы оплачивают проживание и перелет. Для регистрации пришлите, пожалуйста, копию паспорта. Просим ответить сегодня, количество мест ограничено.";

test("already sent documents → urgent steps first", async () => {
  const v = await engine.check({ text: FORUM, context: { done: ["documents"] } });
  assert.equal(v.urgent.length, 1);
  assert.equal(v.urgent[0]!.action, "documents");
  assert.match(v.urgent[0]!.steps.join(" "), /кредитн/);
});

test("no urgent steps when the message looks fine", async () => {
  const v = await engine.check({ text: "Купи хлеба, пожалуйста", context: { done: ["money"] } });
  assert.equal(v.urgent.length, 0);
});

test("unknown sender turns a lone passport request into a warning", async () => {
  const text = "Скинь фото паспорта, я куплю нам билеты на поезд.";
  assert.equal((await engine.check({ text })).level, "no_signs");
  const v = await engine.check({ text, context: { sender: "unknown" } });
  assert.notEqual(v.level, "no_signs");
  assert.ok(v.contextNotes.some((n) => /незнаком/.test(n)));
});

test("'I applied myself' lowers opportunity risk but not a bank scam", async () => {
  const base = await engine.check({ text: "Вы прошли отбор на стажировку. Пришлите копию паспорта до пятницы." });
  const expected = await engine.check({ text: "Вы прошли отбор на стажировку. Пришлите копию паспорта до пятницы.", context: { expected: true } });
  assert.ok(expected.score < base.score, `${expected.score} < ${base.score}`);
  const bank = "Служба безопасности банка: подозрительная операция, переведите деньги на безопасный счет";
  assert.equal((await engine.check({ text: bank, context: { expected: true } })).score, (await engine.check({ text: bank })).score);
});

test("context is read from the user's own words", () => {
  const c = parseContextNote("Я не знаю этот номер, мне звонили. Я уже скинула фото паспорта и назвала код");
  assert.deepEqual(c.done?.sort(), ["code", "documents"]);
  assert.equal(c.sender, "unknown");
  assert.equal(c.channel, "call");
  assert.deepEqual(parseContextNote("я сама подавала заявку на этот форум").expected, true);
  assert.deepEqual(mergeContext({ done: ["money"] }, { done: ["code"], sender: "known" }).done, ["money", "code"]);
});
