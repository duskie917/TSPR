import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/analysis/engine.ts";
import { analyzeRules, deobfuscate } from "../src/analysis/rules.ts";
import { analyzeUrl, extractUrls, registrableDomain } from "../src/analysis/urls.ts";
import { analyzePhone, extractPhones, normalizePhone } from "../src/analysis/phones.ts";
import { analyzeFile } from "../src/analysis/files.ts";
import type { AiAnalyzer } from "../src/analysis/ai.ts";

const engine = new Engine();

const SCAMS: [string, string, string][] = [
  [
    "fake_nbkr_credit",
    "Национальный банк КР уведомляет: вам одобрен кредит 150 000 сом. Для получения оплатите страховой взнос 3 500 сом. Сертификат с печатью прилагается.",
    "danger",
  ],
  [
    "bank_security_call",
    "Здравствуйте, служба безопасности MBANK. По вашей карте подозрительная операция. Чтобы сохранить деньги, переведите их на безопасный счет.",
    "danger",
  ],
  ["sms_code_request", "Вам пришел код из смс, продиктуйте мне код, я случайно указал ваш номер", "danger"],
  [
    "police_impersonation",
    "С вами говорит следователь МВД. Вы являетесь соучастником уголовного дела. Никому не рассказывайте о нашем разговоре.",
    "danger",
  ],
  ["relative_in_trouble", "Мама, это я, попал в ДТП, это мой новый номер, не звони, срочно нужны деньги", "danger"],
  ["malicious_apk", "Приглашение на той! Скачай файл: Chakyruu.apk", "danger"],
  ["fake_job", "Работа на дому! Ставить лайки и писать отзывы, 2000 сом в день. Чтобы начать, внесите депозит 500 сом.", "danger"],
  ["marketplace_scam", "Я купил ваш товар на Lalafo. Чтобы получить оплату по ссылке, введите данные карты: lalafo-pay.top/deal", "danger"],
  ["account_takeover", "Привет! Проголосуй пожалуйста за мою племянницу в конкурсе, там нужно подтвердить номер telegram-vote.xyz", "danger"],
  ["phishing_site", "Ваша карта заблокирована. Войдите для разблокировки: https://mbank-secure.top/login", "danger"],
  ["investment_scam","Инвестиции в крипту! Гарантированный доход 5% в день без риска. Ваш личный куратор ждет.", "danger"],
];

for (const [scheme, text, level] of SCAMS) {
  test(`detects ${scheme}`, async () => {
    const v = await engine.check({ text });
    assert.equal(v.schemeId, scheme, `scheme for: ${text}\nsignals: ${JSON.stringify(v.signals)}`);
    assert.equal(v.level, level, `level for: ${text} (score ${v.score})`);
  });
}

const BENIGN = [
  "Привет! Во сколько встречаемся завтра? Я возьму торт.",
  "Ваш код подтверждения: 4821. Никому не сообщайте этот код.",
  "Оплата 1200 сом в магазине Globus прошла успешно. Баланс: 15 300 сом.",
  "Посмотри статью https://24.kg/obschestvo/123/ про погоду",
  "Банк перенес обслуживание на субботу, приложение будет недоступно с 02:00 до 04:00.",
];

for (const text of BENIGN) {
  test(`no false alarm: ${text.slice(0, 40)}`, async () => {
    const v = await engine.check({ text });
    assert.equal(v.level, "no_signs", `score ${v.score}: ${JSON.stringify(v.signals)}`);
  });
}

test("never claims something is safe", async () => {
  const v = await engine.check({ text: "Привет, как дела?" });
  const all = [...v.advice, ...v.signals.map((s) => s.text)].join(" ").toLowerCase();
  assert.ok(!/безопасно на 100|это безопасно/.test(all));
});

test("deobfuscates Latin look-alike letters", () => {
  assert.equal(deobfuscate("kредит oдoбрен"), "кредит одобрен");
  assert.equal(deobfuscate("visit mbank.kg"), "visit mbank.kg");
  assert.ok(analyzeRules("Вам oдoбрен kредит, oплатите страховой взнос").obfuscated);
});

test("url extraction", () => {
  assert.deepEqual(extractUrls("зайди на nbkr-credit.top/form, быстро"), ["nbkr-credit.top/form"]);
  assert.deepEqual(extractUrls("https://mbank.kg/ru и т.е. 1.5 раза"), ["https://mbank.kg/ru"]);
  assert.deepEqual(extractUrls("пиши на info@mail.ru"), []);
});

test("url heuristics", () => {
  assert.ok(analyzeUrl("https://mbank-bonus.top/login").score >= 70);
  assert.ok(analyzeUrl("https://rnbank.kg").score >= 50, "rn → m typosquat");
  assert.ok(analyzeUrl("https://optimabamk.kg").score >= 50, "typosquat");
  assert.ok(analyzeUrl("https://t.me/nbkr_credit_bot").score >= 40);
  assert.ok(analyzeUrl("http://185.12.44.7/pay").score >= 35);
  assert.ok(analyzeUrl("https://bit.ly/3abc").score >= 20);
  assert.equal(analyzeUrl("https://www.mbank.kg/ru/cards").score, 0);
  assert.equal(analyzeUrl("https://optimalprice.com").score, 0, "optimal ≠ optima");
  assert.equal(analyzeUrl("https://beeline.ru").score, 0);
  assert.equal(analyzeUrl("https://www.gov.uk").score, 0);
  assert.equal(analyzeUrl("https://24.kg/news").score, 0);
  assert.equal(registrableDomain("a.b.example.com.kg"), "example.com.kg");
});

test("phones", () => {
  assert.equal(normalizePhone("0555 123 456"), "996555123456");
  assert.equal(normalizePhone("+996 (700) 12-34-56"), "996700123456");
  assert.deepEqual(extractPhones("звоните +7 912 345 67 89 или 0555123456"), ["+7 912 345 67 89", "0555123456"]);
  assert.equal(analyzePhone("+996555123456").score, 0);
  assert.ok(analyzePhone("+79123456789").score > 0);
});

test("files", () => {
  assert.ok(analyzeFile({ name: "Приглашение на той.apk" }).score >= 75);
  assert.ok(analyzeFile({ name: "photo.jpg.exe" }).score >= 80);
  assert.equal(analyzeFile({ name: "report.pdf" }).score, 0);
});

test("community reports raise the risk of a number", async () => {
  const reports = { reportCount: (kind: string, value: string) => (kind === "phone" && value === "996555000111" ? 3 : 0) };
  const v = await new Engine({ reports }).check({ phone: "0555 000 111" });
  assert.equal(v.level, "danger");
});

test("AI can raise risk but not lower it", async () => {
  const lowAi: AiAnalyzer = {
    assess: async () => ({ risk: "low", schemeId: "none", redFlags: [], explanation: "Все в порядке", advice: [] }),
  };
  const highAi: AiAnalyzer = {
    assess: async () => ({ risk: "high", schemeId: "other", redFlags: ["Странная просьба"], explanation: "x", advice: ["Позвоните в банк"] }),
  };
  const scam = SCAMS[0]![1];
  assert.equal((await new Engine({ ai: lowAi }).check({ text: scam })).level, "danger");
  const raised = await new Engine({ ai: highAi }).check({ text: "Привет, сможешь помочь с одним делом?" });
  assert.equal(raised.level, "danger");
  assert.equal(raised.schemeId, "other");
  assert.deepEqual(raised.advice, ["Позвоните в банк"]);
});

test("AI failure falls back to rules", async () => {
  const broken: AiAnalyzer = { assess: async () => { throw new Error("network"); } };
  const v = await new Engine({ ai: broken }).check({ text: SCAMS[1]![1] });
  assert.equal(v.level, "danger");
  assert.equal(v.aiUsed, false);
  assert.equal(v.aiError, "network");
});

const NEW_SCHEMES: [string, string][] = [
  ["romance_scam", "Дорогая моя, я военный врач, служу в Сирии. Я отправил тебе подарок, но посылка застряла на таможне, переведи 15 000 сом на таможенный сбор"],
  ["fake_charity", "Помогите собрать на операцию ребенку! Каждый сом важен. Карта мамы: 4169 5853 1234 5678. Перешлите всем друзьям"],
  ["fake_fine", "Безопасный город: у вас неоплаченный штраф 3000 сом. Оплатите сегодня по ссылке, иначе арест счета: bgorod-shtraf.top/pay"],
  ["operator_sim", "Уважаемый абонент! Срок действия вашего номера истекает. Чтобы продлить договор, назовите код из СМС, иначе ваш номер будет заблокирован"],
];
for (const [scheme, text] of NEW_SCHEMES) {
  test(`detects ${scheme}`, async () => {
    const v = await engine.check({ text });
    assert.equal(v.schemeId, scheme, JSON.stringify(v.signals));
    assert.notEqual(v.level, "no_signs");
  });
}

test("legit charity report and real fine reminder do not alarm", async () => {
  for (const text of [
    "Фонд опубликовал отчет: в октябре собрано 2,4 млн сом, оплачено лечение 12 детей.",
    "Напоминаем: срок уплаты налога на имущество — до 1 декабря. Оплатить можно в приложении вашего банка.",
  ]) {
    const v = await engine.check({ text });
    assert.equal(v.level, "no_signs", `${text}: ${v.score} ${JSON.stringify(v.signals)}`);
  }
});

test("reasoning explains the manipulation chain", async () => {
  const v = await engine.check({
    text: "Служба безопасности банка: подозрительная операция по вашей карте. Срочно продиктуйте код из СМС и никому не говорите.",
  });
  const stages = v.reasoning.chain.map((c) => c.stage);
  assert.deepEqual(stages, ["trust", "bait", "urgency", "action"]);
  assert.match(v.reasoning.conclusion, /все 4 шага/);
  assert.ok(v.reasoning.reality);
  const calm = await engine.check({ text: "Привет, купи хлеба" });
  assert.equal(calm.reasoning.chain.length, 0);
  assert.match(calm.reasoning.conclusion, /приемов манипуляции нет/);
});

const FORUM =
  "Здравствуйте! Ваш контакт нам передали коллеги. Приглашаем вас принять участие в Международном молодежном форуме лидеров в Стамбуле. Участие бесплатное, организаторы оплачивают проживание и перелет. Для регистрации пришлите, пожалуйста, копию паспорта. Просим ответить сегодня, количество мест ограничено.";

test("opportunity + passport request is flagged without any money, code or link", async () => {
  const v = await engine.check({ text: FORUM });
  assert.equal(v.level, "danger");
  assert.equal(v.schemeId, "opportunity_scam");
  assert.deepEqual(v.reasoning.chain.map((c) => c.stage), ["trust", "bait", "urgency", "action"]);
  assert.match(v.reasoning.intent[0]!.goal, /паспорт/);
  assert.ok(v.reasoning.missing.some((m) => /организатор/i.test(m)), "names the missing organizer");
  assert.ok(v.reasoning.verify.some((m) => /коллег/i.test(m)), "suggests checking with colleagues");
});

test("organizer with a site is not reported as unverifiable", async () => {
  const v = await engine.check({ text: `${FORUM} Подробности на сайте leadersforum.org` });
  assert.ok(!v.signals.some((s) => s.tag === "unverified_org"));
});

test("documents via an official channel are not an attack", async () => {
  const v = await engine.check({ text: "Для открытия счета возьмите с собой паспорт и приходите в любое отделение банка." });
  assert.equal(v.level, "no_signs");
  assert.equal(v.reasoning.chain.length, 0);
});

test("a forwarded warning is not fraud, but a scam posing as a warning is", async () => {
  const warning = await engine.check({ text: "Мошенники звонят от имени банка и просят код из СМС. Никогда не сообщайте коды." });
  assert.equal(warning.level, "no_signs");
  const disguised = await engine.check({
    text: "Внимание, мошенники! Служба безопасности банка: с вашей карты пытаются списать деньги. Срочно переведите их на безопасный счет и никому не говорите.",
  });
  assert.equal(disguised.level, "danger");
});
