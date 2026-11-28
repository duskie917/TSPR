import { createHash } from "node:crypto";
import { clamp, type FileInfo, type Signal } from "./types.ts";

const EXECUTABLE = new Set(["apk", "xapk", "apks", "exe", "scr", "bat", "cmd", "com", "msi", "js", "jse", "vbs", "vbe", "jar", "ps1", "hta", "lnk", "dll", "pif", "wsf", "dex", "ipa"]);
const ARCHIVE = new Set(["zip", "rar", "7z", "tar", "gz", "iso", "img"]);
const MACRO_DOCS = new Set(["docm", "xlsm", "pptm", "xlam"]);
const DOC_LIKE = new Set(["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "mp4", "mov", "txt"]);

export interface FileFinding {
  score: number;
  signals: Signal[];
}

export function analyzeFile(file: FileInfo): FileFinding {
  const signals: Signal[] = [];
  const add = (text: string, weight: number) => signals.push({ text, weight, source: "file", stage: "action" });
  const name = (file.name ?? "").toLowerCase().trim();
  const parts = name.split(".");
  const ext = parts.length > 1 ? (parts.pop() ?? "") : "";
  const prevExt = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";

  if (ext === "apk" || ext === "xapk" || ext === "apks" || file.mimeType === "application/vnd.android.package-archive") {
    add("Это установочный файл Android-приложения (APK). Через такие файлы воруют доступ к банку и СМС", 75);
  } else if (EXECUTABLE.has(ext)) {
    add(`Это исполняемый файл (.${ext}) — он может запустить вредоносную программу`, 60);
  }
  if (ext && DOC_LIKE.has(prevExt) && (EXECUTABLE.has(ext) || ARCHIVE.has(ext))) {
    add(`Двойное расширение «.${prevExt}.${ext}» — файл притворяется документом или фото`, 25);
  }
  if (/\s{3,}|[‮‏]/.test(file.name ?? "")) add("Имя файла скрывает настоящее расширение", 30);
  if (ARCHIVE.has(ext)) add("Архив: внутри может быть спрятана программа", 15);
  if (MACRO_DOCS.has(ext)) add("Документ с макросами — может запустить вредоносный код", 35);
  if (/(приглашени|чакыруу|фото|photo|видео|video|документ|скриншот|invite|той)/i.test(name) && EXECUTABLE.has(ext)) {
    add("Название как у фото/приглашения, но внутри программа — классическая схема", 15);
  }

  return { score: clamp(signals.reduce((s, x) => s + x.weight, 0)), signals };
}

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface VirusTotalResult {
  known: boolean;
  malicious: number;
  suspicious: number;
  total: number;
}

/** Looks up a file hash on VirusTotal (no upload, so the user's file never leaves the bot). */
export async function virusTotalLookup(hash: string, apiKey: string): Promise<VirusTotalResult | undefined> {
  if (!apiKey) return undefined;
  const res = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, {
    headers: { "x-apikey": apiKey },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return { known: false, malicious: 0, suspicious: 0, total: 0 };
  if (!res.ok) throw new Error(`VirusTotal HTTP ${res.status}`);
  const data = (await res.json()) as {
    data?: { attributes?: { last_analysis_stats?: Record<string, number> } };
  };
  const stats = data.data?.attributes?.last_analysis_stats ?? {};
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return { known: true, malicious: stats.malicious ?? 0, suspicious: stats.suspicious ?? 0, total };
}
