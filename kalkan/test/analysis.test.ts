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
  ["investment_scam", "Инвестиции в крипту! Гарантированный доход 5% в день без риска. Ваш личный куратор ждет.", "danger"],
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
  assert.deepEqual(extractUrls("зайди на nbkr-credit.top/form, быстро"), ["http://nbkr-credit.top/form"]);
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
