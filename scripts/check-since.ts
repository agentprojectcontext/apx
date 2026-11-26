#!/usr/bin/env node
// `pnpm check:since`: what people are told is new says the release that really brings it. A news entry or a welcome
// slide no release has yet names the next release of this line (staging's work: the next minor, or the patch the owner
// declared in scripts/next-release.json; main's: the next patch or minor), never one already cut without it. At a release, `--release v2.x.y` asks that everything new since
// the last tag says that version (rules/RELEASE.md#what-people-are-told).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
  /** What the owner declared staging ships as (scripts/next-release.json); stale once that release is cut. */
  declared?: string | undefined;
};

/** What is wrong with each item's `since`, in words a release cutter can act on. */
export function sinceProblems(items: readonly Told[], line: Line): string[] {
  const latest = parse(line.latest);
  if (!latest) return [`the newest release tag ${line.latest} is not a version`];
  const minor: Version = [latest[0], latest[1] + 1, 0];
  const patch: Version = [latest[0], latest[1], latest[2] + 1];
  const release = line.release ? parse(line.release) : undefined;
  const out: string[] = [];
  const declared = line.declared ? parse(line.declared) : undefined;
  if (line.declared && !declared) return [`scripts/next-release.json names ${line.declared}, which is not a version`];
  // A declaration already cut no longer applies; one that skips a release is a typo, not a plan.
  const planned = declared && compare(declared, latest) > 0 ? declared : undefined;
  if (planned && compare(planned, patch) !== 0 && compare(planned, minor) !== 0)
    return [
      `scripts/next-release.json names ${show(planned)}, but after v${line.latest} comes ${show(patch)} or ${show(minor)}`,
    ];
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
    const next = line.staging ? [planned ?? minor] : [patch, minor];
    const why = !line.staging
      ? ""
      : planned
        ? " (staging ships as declared in scripts/next-release.json)"
        : " (staging ships in the next minor)";
    if (!next.some((n) => compare(v, n) === 0))
      out.push(`${name}, but the next release of this line is ${next.map(show).join(" or ")}${why}`);
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

/** The release the owner said staging ships as, when it is not the next minor. */
function declaredRelease(root: string): string | undefined {
  const file = path.join(root, "scripts", "next-release.json");
  if (!fs.existsSync(file)) return undefined;
  const { staging } = JSON.parse(fs.readFileSync(file, "utf8")) as { staging?: unknown };
  return typeof staging === "string" ? staging : undefined;
}

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
    declared: declaredRelease(root),
    shipped: (item) => {
      const where = WHERE[item.kind];
      return tryGit(["grep", "-q", "-F", where.needle(item.id), tag, "--", where.path], root) !== undefined;
    },
  };
}

/** The docs' What's new pages, which keep every release: one cut without its own section is refused. */
export const WHATS_NEW_PAGES = [
  "apps/docs/src/content/docs/reference/whats-new.mdx",
  "apps/docs/src/content/docs/es/reference/whats-new.mdx",
] as const;

/** Each What's new page has a `## x.y.z` section for the release being cut (RELEASE.md#whats-new-page). */
export function whatsNewProblems(release: string, pages: ReadonlyArray<{ path: string; text: string }>): string[] {
  const heading = new RegExp(`^## ${release.replace(/\./g, "\\.")}\\s*$`, "m");
  return pages
    .filter((page) => !heading.test(page.text))
    .map((page) => `${page.path} has no "## ${release}" section: add what this release brings (or that it only fixes)`);
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
  if (release)
    problems.push(
      ...whatsNewProblems(
        release.replace(/^v/, ""),
        WHATS_NEW_PAGES.map((page) => ({ path: page, text: fs.readFileSync(path.join(root, page), "utf8") })),
      ),
    );
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
