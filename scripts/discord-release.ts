#!/usr/bin/env node
// Announces a v2 release on Discord (the webhook v1's releases use) once its files are attached: what is new and fixed,
// read from the commits since the previous v2 tag, and how each install updates.
//   TAG=v2.3.4 WEBHOOK=… [ROLE_ID=…] [BETA=1] node scripts/discord-release.ts [--dry]
import { execFileSync } from "node:child_process";

const REPO = "agentprojectcontext/apx";
const BRAND = 4176208; // APX green
const FIELD_MAX = 1024;
const PER_SECTION = 10;
const SECTIONS = [
  { type: "feat", name: "Nuevo" },
  { type: "fix", name: "Arreglado" },
  { type: "perf", name: "Más rápido" },
] as const;

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** The v2 tag before this one, by version (not by date). */
export function previousTag(tag: string, tags: string[]): string | undefined {
  const key = (t: string) => t.slice(1).split(".").map(Number);
  // Negative when a comes before b.
  const cmp = (a: string, b: string) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  return tags.filter((t) => /^v2\.\d+\.\d+$/.test(t) && cmp(t, tag) < 0).sort((a, b) => cmp(b, a))[0];
}

/** `feat(web): mark every chat read` → the section it goes in and "Mark every chat read". */
export function sections(subjects: string[]): Array<{ name: string; value: string }> {
  return SECTIONS.flatMap(({ type, name }) => {
    const lines = subjects
      .map((s) => new RegExp(`^${type}(\\([^)]*\\))?!?:\\s*(.+)$`).exec(s)?.[2])
      .filter((s): s is string => Boolean(s))
      // The command keeps its own case (`apx …`); any other line starts as a sentence.
      .map((s) => `• ${s.startsWith("apx ") ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`}`);
    if (!lines.length) return [];
    const shown = lines.slice(0, PER_SECTION);
    const more = lines.length - shown.length;
    let value = shown.join("\n") + (more > 0 ? `\n…y ${more} más` : "");
    if (value.length > FIELD_MAX) value = `${value.slice(0, FIELD_MAX - 1)}…`;
    return [{ name, value }];
  });
}

export function payload(o: { tag: string; previous?: string; subjects: string[]; roleId?: string; beta: boolean }) {
  const version = o.tag.slice(1);
  const release = `https://github.com/${REPO}/releases/tag/${o.tag}`;
  const compare = o.previous ? `https://github.com/${REPO}/compare/${o.previous}...${o.tag}` : release;
  const fields = sections(o.subjects);
  return {
    username: "APX",
    content: `${o.roleId ? `<@&${o.roleId}> ` : ""}**APX** v${version}${o.beta ? " · beta" : ""}`,
    ...(o.roleId ? { allowed_mentions: { roles: [o.roleId] } } : { allowed_mentions: { parse: [] } }),
    embeds: [
      {
        title: `${version.endsWith(".0") ? "🚀" : "🔧"} APX v${version}${o.beta ? " · beta" : ""}`,
        url: release,
        color: BRAND,
        description:
          "La app de escritorio te ofrece la actualización sola. En un servidor: `apx upgrade`. " +
          "En el celular: bajá el APK nuevo de la versión e instalalo encima.\n" +
          `[Versión](${release}) · [Cambios](${compare})`,
        ...(fields.length ? { fields } : {}),
      },
    ],
  };
}

if (import.meta.main) {
  const tag = process.env.TAG ?? "";
  if (!/^v2\.\d+\.\d+$/.test(tag)) throw new Error(`TAG must be a v2 version tag, got "${tag}"`);
  const previous = previousTag(tag, git("tag", "--list", "v2.*").split("\n"));
  const subjects = git("log", "--no-merges", "--format=%s", previous ? `${previous}..${tag}` : tag).split("\n");
  const body = payload({
    tag,
    ...(previous ? { previous } : {}),
    subjects,
    ...(process.env.ROLE_ID ? { roleId: process.env.ROLE_ID } : {}),
    beta: process.env.BETA === "1",
  });
  if (process.argv.includes("--dry")) {
    console.log(JSON.stringify(body, null, 2));
  } else {
    // A pasted secret carries whatever the clipboard had; and the release is out already, so a failure only warns.
    const webhook = (process.env.WEBHOOK ?? "").replace(/\s+/g, "");
    if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhook)) {
      console.log("no Discord webhook: nothing announced");
    } else {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) console.log(`announced ${tag} (HTTP ${res.status})`);
      else console.log(`::warning::Discord rejected the announcement (HTTP ${res.status}): ${await res.text()}`);
    }
  }
}
