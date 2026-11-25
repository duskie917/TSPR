import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ReportKind = "phone" | "domain";

export interface CheckRow {
  id: number;
  tg_id: number | null;
  tenant_id: number | null;
  kind: string;
  level: string;
  score: number;
  scheme_id: string;
  indicators: string;
  feedback: number | null;
  created_at: string;
}

export interface Indicators {
  phones: string[];
  domains: string[];
}

/**
 * Privacy by design: we never store the text, image or file a user sends.
 * Only the verdict, the scheme and extracted indicators (numbers, domains) are kept.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        tg_id INTEGER PRIMARY KEY,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id INTEGER,
        tenant_id INTEGER,
        kind TEXT NOT NULL,
        level TEXT NOT NULL,
        score INTEGER NOT NULL,
        scheme_id TEXT NOT NULL,
        indicators TEXT NOT NULL DEFAULT '{}',
        feedback INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS checks_created ON checks(created_at);
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        reporter_tg_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(kind, value, reporter_tg_id)
      );
      CREATE INDEX IF NOT EXISTS reports_value ON reports(kind, value);
      CREATE TABLE IF NOT EXISTS family_invites (
        code TEXT PRIMARY KEY,
        guardian_tg_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS family_links (
        guardian_tg_id INTEGER NOT NULL,
        ward_tg_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (guardian_tg_id, ward_tg_id)
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ---- users ----
  upsertUser(tgId: number, name: string): void {
    this.db
      .prepare("INSERT INTO users (tg_id, name) VALUES (?, ?) ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name")
      .run(tgId, name);
  }

  userName(tgId: number): string | undefined {
    const row = this.db.prepare("SELECT name FROM users WHERE tg_id = ?").get(tgId) as { name: string } | undefined;
    return row?.name;
  }

  // ---- checks ----
  logCheck(entry: {
    tgId?: number;
    tenantId?: number;
    kind: string;
    level: string;
    score: number;
    schemeId: string;
    indicators: Indicators;
  }): number {
    const result = this.db
      .prepare("INSERT INTO checks (tg_id, tenant_id, kind, level, score, scheme_id, indicators) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        entry.tgId ?? null,
        entry.tenantId ?? null,
        entry.kind,
        entry.level,
        entry.score,
        entry.schemeId,
        JSON.stringify(entry.indicators),
      );
    return Number(result.lastInsertRowid);
  }

  getCheck(id: number): CheckRow | undefined {
    return this.db.prepare("SELECT * FROM checks WHERE id = ?").get(id) as CheckRow | undefined;
  }

  setFeedback(id: number, tgId: number, value: 1 | -1): boolean {
    const r = this.db.prepare("UPDATE checks SET feedback = ? WHERE id = ? AND tg_id = ?").run(value, id, tgId);
    return Number(r.changes) > 0;
  }

  // ---- community reports ----
  addReport(kind: ReportKind, value: string, reporterTgId: number | null): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO reports (kind, value, reporter_tg_id) VALUES (?, ?, ?)")
      .run(kind, value.toLowerCase(), reporterTgId);
    return Number(r.changes) > 0;
  }

  reportCount(kind: ReportKind, value: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM reports WHERE kind = ? AND value = ?")
      .get(kind, value.toLowerCase()) as { n: number };
    return Number(row.n);
  }

  // ---- family mode ----
  createInvite(guardianTgId: number): string {
    // Unambiguous characters only, so the code is easy to dictate over the phone.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    this.db.prepare("INSERT INTO family_invites (code, guardian_tg_id) VALUES (?, ?)").run(code, guardianTgId);
    return code;
  }

  /** Links the ward to the guardian who created the code. Codes are single-use and expire after 7 days. */
  redeemInvite(code: string, wardTgId: number): { guardianTgId: number } | { error: "not_found" | "self" } {
    const row = this.db
      .prepare("SELECT guardian_tg_id FROM family_invites WHERE code = ? AND created_at > datetime('now', '-7 days')")
      .get(code.toUpperCase().trim()) as { guardian_tg_id: number } | undefined;
    if (!row) return { error: "not_found" };
    if (row.guardian_tg_id === wardTgId) return { error: "self" };
    this.db
      .prepare("INSERT OR IGNORE INTO family_links (guardian_tg_id, ward_tg_id) VALUES (?, ?)")
      .run(row.guardian_tg_id, wardTgId);
    this.db.prepare("DELETE FROM family_invites WHERE code = ?").run(code.toUpperCase().trim());
    return { guardianTgId: Number(row.guardian_tg_id) };
  }

  guardiansOf(wardTgId: number): number[] {
    return (this.db.prepare("SELECT guardian_tg_id FROM family_links WHERE ward_tg_id = ?").all(wardTgId) as {
      guardian_tg_id: number;
    }[]).map((r) => Number(r.guardian_tg_id));
  }

  wardsOf(guardianTgId: number): number[] {
    return (this.db.prepare("SELECT ward_tg_id FROM family_links WHERE guardian_tg_id = ?").all(guardianTgId) as {
      ward_tg_id: number;
    }[]).map((r) => Number(r.ward_tg_id));
  }

  /** Removes every family link in which the user takes part. */
  unlinkAll(tgId: number): number {
    const r = this.db.prepare("DELETE FROM family_links WHERE guardian_tg_id = ? OR ward_tg_id = ?").run(tgId, tgId);
    return Number(r.changes);
  }

  // ---- B2B tenants ----
  createTenant(name: string): { id: number; apiKey: string } {
    const apiKey = `klk_${randomBytes(24).toString("base64url")}`;
    const r = this.db.prepare("INSERT INTO tenants (name, key_hash) VALUES (?, ?)").run(name, hashKey(apiKey));
    return { id: Number(r.lastInsertRowid), apiKey };
  }

  tenantByKey(apiKey: string): { id: number; name: string } | undefined {
    const row = this.db.prepare("SELECT id, name FROM tenants WHERE key_hash = ?").get(hashKey(apiKey)) as
      | { id: number; name: string }
      | undefined;
    return row ? { id: Number(row.id), name: row.name } : undefined;
  }

  // ---- analytics ----
  stats(days: number, tenantId?: number) {
    const where = `created_at > datetime('now', ?)${tenantId ? " AND tenant_id = ?" : ""}`;
    const args: (string | number)[] = [`-${days} days`];
    if (tenantId) args.push(tenantId);
    const totals = this.db
      .prepare(`SELECT level, COUNT(*) AS n FROM checks WHERE ${where} GROUP BY level`)
      .all(...args) as { level: string; n: number }[];
    const schemes = this.db
      .prepare(
        `SELECT scheme_id, COUNT(*) AS n FROM checks WHERE ${where} AND scheme_id NOT IN ('none') GROUP BY scheme_id ORDER BY n DESC LIMIT 10`,
      )
      .all(...args) as { scheme_id: string; n: number }[];
    const feedback = this.db
      .prepare(`SELECT SUM(feedback = 1) AS up, SUM(feedback = -1) AS down FROM checks WHERE ${where}`)
      .get(...args) as { up: number | null; down: number | null };
    const users = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    const families = this.db.prepare("SELECT COUNT(*) AS n FROM family_links").get() as { n: number };
    const reports = this.db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
    return {
      days,
      checks: Object.fromEntries(totals.map((t) => [t.level, Number(t.n)])) as Record<string, number>,
      topSchemes: schemes.map((s) => ({ schemeId: s.scheme_id, count: Number(s.n) })),
      feedback: { correct: Number(feedback.up ?? 0), wrong: Number(feedback.down ?? 0) },
      users: Number(users.n),
      familyLinks: Number(families.n),
      reports: Number(reports.n),
    };
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
