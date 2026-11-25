import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Engine } from "../analysis/engine.ts";
import { verdictJson } from "../analysis/format.ts";
import { normalizePhone } from "../analysis/phones.ts";
import { schemeName } from "../analysis/schemes.ts";
import type { CheckInput } from "../analysis/types.ts";
import { extractUrls, registrableDomain } from "../analysis/urls.ts";
import type { Store } from "../storage/db.ts";
import { DEMO_HTML } from "./demo.ts";

export interface ApiDeps {
  engine: Engine;
  store: Store;
  demo: boolean;
}

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

const str = (v: unknown, max = 6000): string | undefined => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);

function toInput(body: Record<string, unknown>): CheckInput {
  const text = [str(body.text), str(body.url, 2000)].filter(Boolean).join("\n") || undefined;
  const input: CheckInput = { text, phone: str(body.phone, 40), forwardedFrom: str(body.forwarded_from, 200) };
  if (!input.text && !input.phone) throw new HttpError(400, "provide at least one of: text, url, phone");
  return input;
}

/** Fixed-window limiter for the public demo endpoint. */
function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    entry.n++;
    return entry.n <= max;
  };
}

export function createApi({ engine, store, demo }: ApiDeps): Server {
  const demoLimit = makeLimiter(10, 60_000);

  function tenantOf(req: IncomingMessage) {
    const auth = req.headers.authorization ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const tenant = key ? store.tenantByKey(key) : undefined;
    if (!tenant) throw new HttpError(401, "missing or invalid API key");
    return tenant;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /health") return send(res, 200, { ok: true });

    if (demo && route === "GET /") return send(res, 200, DEMO_HTML, "text/html; charset=utf-8");

    if (demo && route === "POST /demo/check") {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
      if (!demoLimit(ip)) throw new HttpError(429, "too many requests, try again in a minute");
      const verdict = await engine.check(toInput(await readJson(req)));
      store.logCheck({ kind: "demo", level: verdict.level, score: verdict.score, schemeId: verdict.schemeId, indicators: { phones: [], domains: [] } });
      return send(res, 200, verdictJson(verdict));
    }

    // ---- B2B API (API key required) ----
    if (route === "POST /v1/check") {
      const tenant = tenantOf(req);
      const verdict = await engine.check(toInput(await readJson(req)));
      store.logCheck({
        tenantId: tenant.id,
        kind: "api",
        level: verdict.level,
        score: verdict.score,
        schemeId: verdict.schemeId,
        indicators: {
          phones: verdict.phones.map((p) => p.normalized),
          domains: [...new Set(verdict.urls.map((u) => registrableDomain(u.host)))],
        },
      });
      return send(res, 200, verdictJson(verdict));
    }

    if (route === "POST /v1/reports") {
      // Partners (e.g. a bank's anti-fraud team) push confirmed fraud numbers and domains.
      const tenant = tenantOf(req);
      const body = await readJson(req);
      const phones = (Array.isArray(body.phones) ? body.phones : []).filter((x): x is string => typeof x === "string").slice(0, 500);
      const domains = (Array.isArray(body.domains) ? body.domains : []).filter((x): x is string => typeof x === "string").slice(0, 500);
      let added = 0;
      // Negative reporter ids mark partner reports so they never collide with Telegram users.
      for (const p of phones) if (normalizePhone(p).length >= 9 && store.addReport("phone", normalizePhone(p), -tenant.id)) added++;
      for (const d of domains) {
        const u = extractUrls(d)[0];
        if (u && store.addReport("domain", registrableDomain(new URL(u).hostname), -tenant.id)) added++;
      }
      return send(res, 200, { added });
    }

    if (route === "GET /v1/stats") {
      const tenant = tenantOf(req);
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const own = store.stats(days, tenant.id);
      const all = store.stats(days);
      const named = (list: { schemeId: string; count: number }[]) => list.map((s) => ({ ...s, name: schemeName(s.schemeId) ?? null }));
      return send(res, 200, {
        tenant: tenant.name,
        days,
        your_checks: own.checks,
        your_top_schemes: named(own.topSchemes),
        // Anonymised trend across all channels (bot + all partners): what scams are rising right now.
        market_top_schemes: named(all.topSchemes),
        community_reports: all.reports,
      });
    }

    throw new HttpError(404, "not found");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error("api error", err);
      send(res, 500, { error: "internal error" });
    });
  });
}
