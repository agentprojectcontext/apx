#!/usr/bin/env node
// `pnpm check:since`: what people are told is new says the release that really brings it. A news entry or a welcome
// slide no release has yet names the next release of this line (staging's work: the next minor; main's: the next
// patch or minor), never one already cut without it. At a release, `--release v2.x.y` asks that everything new since
// the last tag says that version (rules/RELEASE.md#what-people-are-told).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Told = { kind: "news" | "slide"; id: string; since: string };
type Version = [number, number, number];

const parse = (v: string): Version | undefined => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const show = (v: Version) => v.join(".");

type Line = {
  /** The newest release tag this commit has, as x.y.z. */
  latest: string;
  /** Whether this commit carries staging's work (it ships in the next minor), not only main's. */
  staging: boolean;
  /** Whether the newest release already has this item (told then; its `since` stays as it was). */
  shipped(item: Told): boolean;
  /** The version being released, when a tag is about to be cut. */
  release?: string | undefined;
};

/** What is wrong with each item's `since`, in words a release cutter can act on. */
export function sinceProblems(items: readonly Told[], line: Line): string[] {
  const latest = parse(line.latest);
  if (!latest) return [`the newest release tag ${line.latest} is not a version`];
  const minor: Version = [latest[0], latest[1] + 1, 0];
  const patch: Version = [latest[0], latest[1], latest[2] + 1];
  const release = line.release ? parse(line.release) : undefined;
  const out: string[] = [];
  for (const item of items) {
    const name = `${item.kind} "${item.id}" says since ${item.since}`;
    const v = parse(item.since);
    if (!v) {
      out.push(`${name}, which is not a version`);
      continue;
    }
    if (line.shipped(item)) continue;
    if (compare(v, latest) <= 0) {
      out.push(`${name}, but v${line.latest} does not have it yet: give it the release that will`);
      continue;
    }
    if (release) {
      if (compare(v, release) !== 0) out.push(`${name}, but it ships in ${show(release)}`);
      continue;
    }
    const next = line.staging ? [minor] : [patch, minor];
    if (!next.some((n) => compare(v, n) === 0))
      out.push(
        `${name}, but the next release of this line is ${next.map(show).join(" or ")}${line.staging ? " (staging ships in the next minor)" : ""}`,
      );
  }
  return out;
}

const git = (args: string[], cwd: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (args: string[], cwd: string): string | undefined => {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
};

/** How a release's tree names an item: a news entry by its `id`, a slide by its key in the slides' own file. */
const WHERE: Record<Told["kind"], { needle: (id: string) => string; path: string }> = {
  news: { needle: (id) => `id: "${id}"`, path: "apps/core/src/news" },
  slide: { needle: (id) => `"${id}"`, path: "apps/web/src/shell/welcomeFilm.ts" },
};

function line(root: string, release: string | undefined): Line | undefined {
  const tag = tryGit(["describe", "--tags", "--abbrev=0", "--match", "v2.*", "HEAD"], root);
  if (!tag) return undefined;
  // Staging's own work: HEAD reaches staging commits main has not taken yet.
  const staging = (() => {
    const base = tryGit(["merge-base", "HEAD", "origin/staging"], root);
    if (!base) return false;
    return tryGit(["merge-base", "--is-ancestor", base, "origin/main"], root) === undefined;
  })();
  return {
    latest: tag.replace(/^v/, ""),
    staging,
    release,
    shipped: (item) => {
      const where = WHERE[item.kind];
      return tryGit(["grep", "-q", "-F", where.needle(item.id), tag, "--", where.path], root) !== undefined;
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const at = argv.indexOf("--release");
  const release = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !parse(release ?? "")) throw new Error("--release takes a version, v2.x.y");
  const { NEWS } = await import("../apps/core/src/news/entries.ts");
  const { WELCOME_SLIDES } = await import("../apps/web/src/shell/welcomeFilm.ts");
  const items: Told[] = [
    ...NEWS.map((n) => ({ kind: "news" as const, id: n.id, since: n.since })),
    ...WELCOME_SLIDES.map((s) => ({ kind: "slide" as const, id: s.key, since: s.since })),
  ];
  const l = line(root, release?.replace(/^v/, ""));
  if (!l) {
    // A clone without release tags (a shallow one) has nothing to compare with.
    console.log("check:since: no v2 release tag in this clone; nothing to compare with");
    return 0;
  }
  const problems = sinceProblems(items, l);
  for (const p of problems) console.error(`check:since: ${p}`);
  if (!problems.length)
    console.log(
      `check:since: ${items.length} news and slides match real releases (latest v${l.latest}${l.staging ? ", staging" : ""})`,
    );
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`check:since: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
