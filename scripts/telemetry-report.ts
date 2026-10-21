#!/usr/bin/env node
// The telemetry funnel, read from the apx-agents Firestore with the maintainers' own credentials (the database lets
// no one else read). See rules/DECISIONS.md#d-092 and apps/core/src/telemetry.ts for what is sent.
//
//   node scripts/telemetry-report.ts --key ~/keys/apx-agents.json          a summary in the terminal
//   node scripts/telemetry-report.ts --key … --html report.html             the same as a page
//   node scripts/telemetry-report.ts --token "$(gcloud auth print-access-token)"
//
// --key is a service account key (Firebase console › Project settings › Service accounts); GOOGLE_APPLICATION_CREDENTIALS
// works too. --all keeps source checkouts and test installs, left out by default.
import { createSign } from "node:crypto";
import fs from "node:fs";
import { parseArgs } from "node:util";

const PROJECT = "apx-agents";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
export const STAGES = ["installed", "opened", "consent", "setup", "first_run"] as const;

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FsValue> };
};
type FsDoc = { name: string; fields?: Record<string, FsValue> };

export type Install = {
  id: string;
  version: string;
  first_version: string;
  os: string;
  arch: string;
  channel: string;
  usage: boolean | undefined;
  stages: Record<string, string>;
  updated_at: string;
};
export type Day = { install: string; day: string; version: string; numbers: Record<string, number> };

function plain(v: FsValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return undefined;
}

export function toInstall(doc: FsDoc): Install {
  const f = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, plain(v)]));
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  return {
    id: doc.name.split("/").at(-1) ?? "",
    version: s("version"),
    first_version: s("first_version"),
    os: s("os"),
    arch: s("arch"),
    channel: s("channel"),
    usage: typeof f.usage === "boolean" ? f.usage : undefined,
    stages: (f.stages ?? {}) as Record<string, string>,
    updated_at: s("updated_at"),
  };
}

export function toDay(doc: FsDoc): Day {
  const parts = doc.name.split("/");
  const f = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, plain(v)]));
  const numbers: Record<string, number> = {};
  for (const [k, v] of Object.entries(f)) if (typeof v === "number") numbers[k] = v;
  return { install: parts.at(-3) ?? "", day: parts.at(-1) ?? "", version: String(f.version ?? ""), numbers };
}

/** Stages of one flush land seconds apart; a real setup or first message comes at least a tick (30 min) later. */
const SAME_FLUSH_MS = 10_000;

/** An APX that ran before it had telemetry: its first send already carried setup or a first message. */
export function existedBefore(i: Install): boolean {
  const installed = Date.parse(i.stages.installed ?? "");
  return (["setup", "first_run"] as const).some((s) => {
    const at = Date.parse(i.stages[s] ?? "");
    return at - installed <= SAME_FLUSH_MS;
  });
}

const tally = (xs: string[]): Array<[string, number]> => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
};

export function summarize(all: Install[], days: Day[], opts: { all?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const installs = opts.all ? all : all.filter((i) => i.channel !== "source" && i.channel !== "test");
  // The funnel counts new installs only; usage, versions and systems keep every install.
  const fresh = installs.filter((i) => !existedBefore(i));
  const ids = new Set(installs.map((i) => i.id));
  const kept = days.filter((d) => ids.has(d.install));
  const since = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const activeIn = (n: number) =>
    new Set([
      ...kept.filter((d) => d.day >= since(n).slice(0, 10)).map((d) => d.install),
      ...installs.filter((i) => i.updated_at >= since(n)).map((i) => i.id),
    ]).size;
  const answered = installs.filter((i) => i.usage !== undefined);
  const byDay = new Map<string, { reports: number; tokens_in: number; tokens_out: number; runs: number }>();
  for (const d of kept) {
    const cur = byDay.get(d.day) ?? { reports: 0, tokens_in: 0, tokens_out: 0, runs: 0 };
    cur.reports += 1;
    cur.tokens_in += d.numbers.tokens_in ?? 0;
    cur.tokens_out += d.numbers.tokens_out ?? 0;
    cur.runs += d.numbers.runs ?? 0;
    byDay.set(d.day, cur);
  }
  return {
    installs: fresh.length,
    existing: installs.length - fresh.length,
    funnel: STAGES.map((s) => ({ stage: s, installs: fresh.filter((i) => i.stages[s]).length })),
    opt_in: { answered: answered.length, yes: answered.filter((i) => i.usage).length },
    active: { d1: activeIn(1), d7: activeIn(7), d30: activeIn(30) },
    versions: tally(installs.map((i) => i.version)),
    os: tally(installs.map((i) => `${i.os}-${i.arch}`)),
    channels: tally(installs.map((i) => i.channel)),
    days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30),
  };
}
export type Summary = ReturnType<typeof summarize>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** An access token for a service account key, signed here: no Google SDK needed. */
async function tokenFromKey(file: string): Promise<string> {
  const key = JSON.parse(fs.readFileSync(file, "utf8")) as { client_email: string; private_key: string };
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${b64url(sig)}`,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`token: ${body.error_description ?? res.status}`);
  return body.access_token;
}

async function read(token: string): Promise<{ installs: Install[]; days: Day[] }> {
  const auth = { authorization: `Bearer ${token}` };
  const installs: Install[] = [];
  let page = "";
  do {
    const res = await fetch(`${BASE}/installs?pageSize=300${page ? `&pageToken=${page}` : ""}`, { headers: auth });
    if (!res.ok) throw new Error(`installs: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    installs.push(...(body.documents ?? []).map(toInstall));
    page = body.nextPageToken ?? "";
  } while (page);
  const res = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "days", allDescendants: true }] } }),
  });
  if (!res.ok) throw new Error(`days: HTTP ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ document?: FsDoc }>;
  return { installs, days: rows.flatMap((r) => (r.document ? [toDay(r.document)] : [])) };
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export function text(s: Summary): string {
  const out = [`Installs: ${s.installs} new · ${s.existing} running before telemetry`, "", "Funnel (new installs)"];
  for (const f of s.funnel)
    out.push(`  ${f.stage.padEnd(10)} ${String(f.installs).padStart(6)}  ${pct(f.installs, s.installs)}`);
  out.push(
    "",
    `Usage statistics: ${s.opt_in.yes} yes of ${s.opt_in.answered} answered (${pct(s.opt_in.yes, s.opt_in.answered)})`,
  );
  out.push(`Active: ${s.active.d1} today · ${s.active.d7} in 7 days · ${s.active.d30} in 30 days`, "");
  for (const [title, rows] of [
    ["Versions", s.versions],
    ["Systems", s.os],
    ["Installed from", s.channels],
  ] as const) {
    out.push(title);
    for (const [k, n] of rows.slice(0, 10)) out.push(`  ${k.padEnd(24)} ${n}`);
    out.push("");
  }
  out.push("Day          reports   tokens in  tokens out   turns");
  for (const [d, x] of s.days)
    out.push(
      `${d}  ${String(x.reports).padStart(7)} ${String(x.tokens_in).padStart(11)} ${String(x.tokens_out).padStart(11)} ${String(x.runs).padStart(7)}`,
    );
  return out.join("\n");
}

export function html(s: Summary): string {
  const esc = (v: unknown) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const table = (head: string[], rows: unknown[][]) =>
    `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</table>`;
  const bar = (n: number) => `<span class="bar" style="width:${s.installs ? (n / s.installs) * 100 : 0}%"></span>`;
  return `<!doctype html><meta charset="utf-8"><title>APX telemetry</title>
<style>body{font:14px system-ui;margin:32px;max-width:900px;color:#222}h2{margin-top:28px}table{border-collapse:collapse;width:100%}
td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}.bar{display:inline-block;height:10px;background:#3fb950;border-radius:3px}
@media (prefers-color-scheme:dark){body{background:#111;color:#ddd}td,th{border-color:#333}}</style>
<h1>APX telemetry</h1><p>${s.installs} new installs · ${s.existing} running before telemetry · usage statistics ${s.opt_in.yes} of ${s.opt_in.answered} · active ${s.active.d1} today, ${s.active.d7} in 7 days, ${s.active.d30} in 30 days</p>
<h2>Funnel (new installs)</h2><table><tr><th>Step</th><th>Installs</th><th></th></tr>${s.funnel
    .map(
      (f) =>
        `<tr><td>${f.stage}</td><td>${f.installs} (${pct(f.installs, s.installs)})</td><td>${bar(f.installs)}</td></tr>`,
    )
    .join("")}</table>
<h2>Versions</h2>${table(["Version", "Installs"], s.versions)}
<h2>Systems</h2>${table(["System", "Installs"], s.os)}
<h2>Installed from</h2>${table(["Channel", "Installs"], s.channels)}
<h2>Days</h2>${table(
    ["Day", "Reports", "Tokens in", "Tokens out", "Turns"],
    s.days.map(([d, x]) => [d, x.reports, x.tokens_in, x.tokens_out, x.runs]),
  )}`;
}

async function main() {
  const { values } = parseArgs({
    options: { key: { type: "string" }, token: { type: "string" }, html: { type: "string" }, all: { type: "boolean" } },
  });
  const keyFile = values.key ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const token = values.token ?? (keyFile ? await tokenFromKey(keyFile) : undefined);
  if (!token) throw new Error("pass --key <service account json> or --token <access token>");
  const data = await read(token);
  const summary = summarize(data.installs, data.days, { all: values.all ?? false });
  if (values.html) {
    fs.writeFileSync(values.html, html(summary));
    console.log(`wrote ${values.html}`);
  } else console.log(text(summary));
}

if (import.meta.main) await main();
