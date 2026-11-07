// The newest published release before a v2 tag: a tag whose build failed (a draft) is skipped, so its commits are told
// with the version that ships. See RELEASE.md#a-failed-release.
import { execFileSync } from "node:child_process";
import { previousTag, RELEASE_REPO } from "../apps/core/src/release-notes.ts";

export type ReleaseRow = { tag_name: string; draft: boolean };

export function previousRelease(tag: string, releases: ReleaseRow[]): string | undefined {
  return previousTag(
    tag,
    releases.filter((r) => !r.draft).map((r) => r.tag_name),
  );
}

/** Reads the repo's releases with `gh` (GH_TOKEN in CI); drafts are listed only to a token that can write. */
export function publishedPrevious(tag: string): string | undefined {
  const out = execFileSync(
    "gh",
    ["api", "--paginate", `repos/${RELEASE_REPO}/releases?per_page=100`, "--jq", ".[] | {tag_name, draft}"],
    { encoding: "utf8" },
  );
  const rows = out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ReleaseRow);
  return previousRelease(tag, rows);
}
