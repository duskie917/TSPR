import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engine } from "../src/analysis/engine.ts";
import { createApi } from "../src/api/server.ts";
import { Store } from "../src/storage/db.ts";

const store = new Store(":memory:");
const server = createApi({ engine: new Engine({ reports: store }), store, demo: true });
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const { apiKey } = store.createTenant("Test Bank");
const auth = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

test("rejects requests without a valid key", async () => {
  const res = await fetch(`${base}/v1/check`, { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
  const bad = await fetch(`${base}/v1/check`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
  assert.equal(bad.status, 401);
});

test("checks a message for a partner", async () => {
  const res = await fetch(`${base}/v1/check`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "Служба безопасности банка: переведите деньги на безопасный счет", url: "https://mbank-secure.top/login" }),
  });
  assert.equal(res.status, 200);
  const v = (await res.json()) as { level: string; scheme: { id: string }; urls: { score: number }[]; disclaimer: string };
  assert.equal(v.level, "danger");
  assert.equal(v.scheme.id, "bank_security_call");
  assert.ok(v.urls[0]!.score >= 70);
  assert.ok(v.disclaimer);
});

test("validates input", async () => {
  const res = await fetch(`${base}/v1/check`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
  const bad = await fetch(`${base}/v1/check`, { method: "POST", headers: auth, body: "not json" });
  assert.equal(bad.status, 400);
});

test("partners can push fraud indicators and see stats", async () => {
  const push = await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ phones: ["+996 700 111 222"], domains: ["https://evil-example.com/x"] }),
  });
  assert.deepEqual(await push.json(), { added: 2 });
  assert.equal(store.reportCount("domain", "evil-example.com"), 1);

  const stats = await fetch(`${base}/v1/stats?days=7`, { headers: auth });
  const s = (await stats.json()) as { tenant: string; your_checks: Record<string, number>; market_top_schemes: unknown[] };
  assert.equal(s.tenant, "Test Bank");
  assert.equal(s.your_checks.danger, 1);
  assert.ok(s.market_top_schemes.length >= 1);
});

test("demo page and demo endpoint", async () => {
  const page = await fetch(`${base}/`);
  assert.match(await page.text(), /<title>/);
  const res = await fetch(`${base}/demo/check`, { method: "POST", body: JSON.stringify({ text: "Мама, я попал в ДТП, это мой новый номер, не звони" }) });
  assert.equal(((await res.json()) as { level: string }).level, "danger");
});
