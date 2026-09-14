// The rail has to actually use the height it reserves.
//
// THE BUG (2026-09-14). `useVisibleCount` measures the flexible project list and
// decides how many avatars fit. It bailed out with `if (!el || !enabled) return`
// BEFORE creating its ResizeObserver — so a rail that started collapsed never
// got one. Expanding it re-ran the effect, but `useLayoutEffect` runs with the
// DOM updated and the flex heights not yet resolved, so that one measurement
// read the collapsed rail's two slots and set the count to 0. Nothing ever
// recalculated it: expanding, resizing the window, dragging it taller all left
// the count where it was.
//
// Measured in the panel before the fix, at 1280x1050 with 13 projects: the list
// had room for 7 slots and rendered 2 — the "+13" bucket and the Add button —
// with 427px of empty rail underneath. Manu: "podrías hacer que el menú llegue
// hasta config así entran más". It already reached Config; it just refused to
// use it. After: 7 rendered, "+8", 42px left over (the floor's remainder).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rail = fs.readFileSync(
  path.join(ROOT, "src/interfaces/web/src/components/layout/ProjectSidebar.tsx"),
  "utf8",
);
const fit = rail.slice(rail.indexOf("function useVisibleCount"), rail.indexOf("const RAIL_ORDER_MAX"));

test("the rail keeps measuring itself — the observer is never skipped", () => {
  // Only the ref may short-circuit. `enabled` deciding whether to OBSERVE is
  // the bug: it is exactly the flag that flips when the rail opens.
  assert.match(fit, /if \(!el\) return;/, "the only early return is a missing node");
  assert.doesNotMatch(fit, /if \(!el \|\| !enabled\) return/, "the observer must outlive `enabled`");

  // Three chances to get it right: now, after layout, and on every resize.
  assert.match(fit, /measure\(\);/, "synchronously");
  assert.match(fit, /requestAnimationFrame\(measure\)/, "and again once the flex heights resolve");
  assert.match(fit, /new ResizeObserver\(measure\)/);
  assert.match(fit, /cancelAnimationFrame\(raf\); ro\.disconnect\(\)/, "and both are torn down");

  // A zero height is a frame we cannot trust, not an answer: it must leave the
  // count alone rather than writing 0 into it.
  assert.match(fit, /if \(h <= 0\) return;/);

  // The reservation itself is unchanged: one slot for Add, one for "+N".
  assert.match(fit, /const forItems = slots - 1;/);
  assert.match(fit, /forItems >= total \? total : Math\.max\(0, forItems - 1\)/);
});

test("the overflow bucket wears the same grey as the controls under it", () => {
  // The rail has two kinds of tile: a project (coloured, hashed from its name)
  // and a control (grey). "+N" is a control, but it carried `bg-muted/40` — a
  // third shade, visibly fainter than the settings and docs tiles right below
  // it. Manu: "que el color del +11 actual sea igual de gris que el de los
  // botones de abajo de config".
  const CONTROL_GREY = "bg-muted text-muted-fg hover:bg-accent hover:text-foreground dark:bg-muted/60";
  const overflowTrigger = rail.slice(rail.indexOf("function RailProjectMenu"), rail.indexOf("function ProjectRailItem"));
  assert.ok(overflowTrigger.includes(CONTROL_GREY), "the +N trigger uses the control grey");
  // Comments stripped: the note explaining this change quotes the old class, and
  // a check that matches its own explanation is a check of nothing.
  const code = overflowTrigger.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /bg-muted\/40/, "and not the fainter shade it had");

  // The two it has to match, verified live as identical computed colours.
  const avatar = fs.readFileSync(
    path.join(ROOT, "src/interfaces/web/src/components/layout/ProjectAvatar.tsx"),
    "utf8",
  );
  assert.ok(avatar.includes(CONTROL_GREY), "settings (isSettings) is the reference");
  assert.ok(rail.includes(CONTROL_GREY.replace("hover:bg-accent", "transition-colors hover:bg-accent")) ||
    rail.includes(CONTROL_GREY), "docs uses it too");
});

test("Desktop is not a rail tile, and its route is untouched", () => {
  const modules = rail.slice(rail.indexOf("function buildModules"), rail.indexOf("// How many project avatars"));
  assert.doesNotMatch(modules, /id: "desktop"/, "no tile: the rail is the scarcest space in the panel");
  assert.match(modules, /id: "code"/, "the others stay");
  assert.match(modules, /id: "whatsapp"/);
  // Hidden, not removed: `apx desktop` and the tray still open this screen, and
  // a URL somebody bookmarked has to keep working.
  const app = fs.readFileSync(path.join(ROOT, "src/interfaces/web/src/App.tsx"), "utf8");
  assert.match(app, /path="\/desktop\/\*"\s+element=\{<DesktopScreen \/>\}/, "the screen is still routed");
});

test("the rail says which APX this is, under the logo", () => {
  // Manu asked for it small and out of the way — "abajo del logo? chiquito el
  // version actual". The panel already showed the version, but only on the APX
  // Admin screen, which is not where you are when you wonder whether the thing
  // you are looking at has your last change in it.
  assert.match(rail, /data-testid="nav-version"/);
  assert.match(rail, /v\{health\.version\}/, "the daemon's version, rendered plainly");

  // From the DAEMON, through the shared SWR key — not from package.json baked
  // into the bundle. The bundle can be stale while the daemon is not, and after
  // a release those two disagreeing is precisely what you want to be able to see.
  assert.match(rail, /import \{ useDaemonStatus \} from "\.\.\/\.\.\/hooks\/useDaemonStatus"/);
  assert.match(rail, /const \{ health \} = useDaemonStatus\(\)/);

  // Inside the logo button, not next to it: the rail lays its children out with
  // gap-3, so a sibling would open a tile-sized hole for nine pixels of text.
  const logoButton = rail.slice(rail.indexOf('data-testid="nav-home"'), rail.indexOf("{/* The conversational way in."));
  assert.ok(logoButton.includes('data-testid="nav-version"'), "it rides with the logo");
  assert.match(logoButton, /flex cursor-pointer flex-col items-center/, "stacked under it");

  // Nothing at all until it arrives — a placeholder that becomes a number moves
  // the logo on every load.
  assert.match(rail, /\{health\?\.version && \(/);
});
