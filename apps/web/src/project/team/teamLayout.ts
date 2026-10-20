// The Team view's tree: who reports to whom, laid out top-down as a tidy tree (each parent centred over its first and
// last child, sibling subtrees packed by their contours) with siblings grouped by area. Pure (no React, no DOM) so it
// is tested on its own.
import { parentIn } from "@apx/protocol";

export type TeamMember = {
  id: string;
  slug?: string | undefined;
  parent?: string | undefined;
  area?: string | undefined;
  name: string;
};

/** Card size: fits avatar, role/lead chip, two lines of description, stats and footer. */
export const NODE = { w: 244, h: 196, gapX: 28, gapY: 88 } as const;
/** Past this many direct reports with no team of their own, they are laid out in bands by area, like v1. */
const BAND_AT = 4;
/** A band holds at most this many columns of cards; an area with 3 or more people uses 2 columns. */
const BAND_COLS = 4;
/** Rows inside one area's block, closer than levels of the tree. */
const ROW_GAP = 28;

export type PlacedNode = { id: string; x: number; y: number; depth: number };
export type Edge = { from: string; to: string; area: string | undefined };
/** The label over a group of siblings that share an area ("Product · 3"). */
export type AreaPill = { parent: string; area: string; count: number; x: number; y: number };
export type TeamLayout = { nodes: PlacedNode[]; edges: Edge[]; pills: AreaPill[]; width: number; height: number };

/** A laid-out subtree, its own root at x 0: what it holds, and per row of cards (by y) its leftmost and rightmost x. */
type Sub = { nodes: PlacedNode[]; edges: Edge[]; pills: AreaPill[]; rows: Map<number, { l: number; r: number }> };

/**
 * Parents come from `parent:` (a slug or the full id of an agent of the same team; a global agent, which has none, is
 * named by its id). Anyone else hangs under `leadId` when given, so the team is one tree like an org chart; a loop in
 * `parent:` is broken where it closes.
 */
export function layoutTeam(members: TeamMember[], leadId?: string): TeamLayout {
  const parentOf = new Map<string, string>();
  for (const m of members) {
    const p = parentIn(members, m);
    const parent = p ? p.id : m.id !== leadId ? leadId : undefined;
    if (parent && !closesLoop(parentOf, m.id, parent)) parentOf.set(m.id, parent);
  }
  const children = new Map<string, TeamMember[]>();
  for (const m of members) {
    const p = parentOf.get(m.id);
    if (p) children.set(p, [...(children.get(p) ?? []), m]);
  }
  for (const list of children.values()) list.sort(byAreaThenName);
  const roots = members.filter((m) => !parentOf.has(m.id)).sort((a, b) => rank(a, leadId) - rank(b, leadId));

  const lay = (m: TeamMember, depth: number): Sub => {
    const kids = children.get(m.id) ?? [];
    // Many direct reports, none leading a team: blocks by area, packed in bands under the parent.
    if (kids.length > BAND_AT && kids.every((k) => !children.get(k.id)?.length)) return banded(m, kids, depth);
    const sub: Sub = { nodes: [{ id: m.id, x: 0, y: 0, depth }], edges: [], pills: [], rows: new Map() };
    if (kids.length) {
      const forest = pack(
        kids.map((k) => lay(k, depth + 1)),
        NODE.gapX,
      );
      // Centred over its first and last child: one child alone sits right above it and widens nothing.
      const mid = ((forest.at[0] ?? 0) + (forest.at.at(-1) ?? 0)) / 2;
      const y = NODE.h + NODE.gapY;
      merge(sub, forest.sub, -mid, y);
      const centres = kids.map((k, i) => ({ area: k.area, cx: (forest.at[i] ?? 0) - mid + NODE.w / 2 }));
      for (const k of kids) sub.edges.push({ from: m.id, to: k.id, area: k.area });
      for (const group of groupsOf(centres)) {
        if (!group.area) continue;
        const first = group.items[0]?.cx ?? 0;
        const last = group.items.at(-1)?.cx ?? first;
        sub.pills.push({
          parent: m.id,
          area: group.area,
          count: group.items.length,
          x: (first + last) / 2,
          y: NODE.h + NODE.gapY / 2,
        });
      }
    }
    widen(sub.rows, 0, 0);
    return sub;
  };

  const forest = pack(
    roots.map((r) => lay(r, 0)),
    NODE.gapX * 2,
  );
  const all: Sub = { nodes: [], edges: [], pills: [], rows: new Map() };
  merge(all, forest.sub, 0, 0);
  const left = Math.min(0, ...all.nodes.map((n) => n.x));
  for (const n of all.nodes) n.x -= left;
  for (const p of all.pills) p.x -= left;
  return {
    nodes: all.nodes,
    edges: all.edges,
    pills: all.pills,
    width: Math.max(NODE.w, ...all.nodes.map((n) => n.x + NODE.w)),
    height: all.nodes.length ? Math.max(...all.nodes.map((n) => n.y)) + NODE.h : 0,
  };
}

/** A parent over its leaf reports in bands by area, the parent at x 0. */
function banded(m: TeamMember, kids: TeamMember[], depth: number): Sub {
  const plan = bandsOf(kids);
  const w = Math.max(NODE.w, ...plan.map((b) => b.width));
  const x0 = -(w - NODE.w) / 2;
  const sub: Sub = { nodes: [{ id: m.id, x: 0, y: 0, depth }], edges: [], pills: [], rows: new Map() };
  widen(sub.rows, 0, 0);
  let by = NODE.h + NODE.gapY;
  for (const band of plan) {
    let bx = x0 + (w - band.width) / 2;
    for (const g of band.groups) {
      g.members.forEach((k, i) => {
        const x = bx + (i % g.cols) * (NODE.w + NODE.gapX);
        const y = by + Math.floor(i / g.cols) * (NODE.h + ROW_GAP);
        sub.nodes.push({ id: k.id, x, y, depth: depth + 1 });
        sub.edges.push({ from: m.id, to: k.id, area: k.area });
        widen(sub.rows, y, x);
      });
      if (g.area)
        sub.pills.push({
          parent: m.id,
          area: g.area,
          count: g.members.length,
          x: bx + g.width / 2,
          y: by - NODE.gapY / 2,
        });
      bx += g.width + NODE.gapX * 2;
    }
    by += band.height + NODE.gapY;
  }
  return sub;
}

/**
 * Subtrees side by side, each as far left as its contour allows next to the ones before it (at least `gap` apart on
 * every row they share), so a narrow sibling tucks in beside a deep one instead of waiting for its widest row.
 */
function pack(subs: Sub[], gap: number): { sub: Sub; at: number[] } {
  const out: Sub = { nodes: [], edges: [], pills: [], rows: new Map() };
  const at: number[] = [];
  for (const s of subs) {
    // Every subtree has a card at y 0, so each lands right of the one before: the order stays by area and name.
    let dx = at.length ? Number.NEGATIVE_INFINITY : 0;
    for (const [y, row] of s.rows)
      for (const [oy, o] of out.rows)
        if (Math.abs(oy - y) < NODE.h + ROW_GAP) dx = Math.max(dx, o.r + NODE.w + gap - row.l);
    at.push(dx);
    merge(out, s, dx, 0);
  }
  return { sub: out, at };
}

/** Moves `from` by (dx, dy) into `into`. */
function merge(into: Sub, from: Sub, dx: number, dy: number): void {
  for (const n of from.nodes) into.nodes.push({ ...n, x: n.x + dx, y: n.y + dy });
  into.edges.push(...from.edges);
  for (const p of from.pills) into.pills.push({ ...p, x: p.x + dx, y: p.y + dy });
  for (const [y, row] of from.rows) {
    widen(into.rows, y + dy, row.l + dx);
    widen(into.rows, y + dy, row.r + dx);
  }
}

function widen(rows: Sub["rows"], y: number, x: number): void {
  const row = rows.get(y);
  if (row) {
    row.l = Math.min(row.l, x);
    row.r = Math.max(row.r, x);
  } else rows.set(y, { l: x, r: x });
}

type Block = { area: string | undefined; members: TeamMember[]; cols: number; width: number; height: number };
type Band = { groups: Block[]; width: number; height: number };

/** Siblings by area, each area a block (2 columns from 3 people on), packed left to right into bands. */
function bandsOf(kids: TeamMember[]): Band[] {
  const blocks: Block[] = groupsOf(kids.map((k) => ({ ...k, area: k.area }))).map((g) => {
    const cols = g.items.length >= 3 ? 2 : g.items.length;
    const rows = Math.ceil(g.items.length / cols);
    return {
      area: g.area,
      members: g.items,
      cols,
      width: cols * NODE.w + (cols - 1) * NODE.gapX,
      height: rows * NODE.h + (rows - 1) * ROW_GAP,
    };
  });
  const out: Band[] = [];
  let cur: Band | undefined;
  let used = 0;
  for (const b of blocks) {
    if (!cur || used + b.cols > BAND_COLS) {
      cur = { groups: [], width: 0, height: 0 };
      out.push(cur);
      used = 0;
    }
    cur.width += (cur.groups.length ? NODE.gapX * 2 : 0) + b.width;
    cur.height = Math.max(cur.height, b.height);
    cur.groups.push(b);
    used += b.cols;
  }
  return out;
}

function closesLoop(parentOf: Map<string, string>, id: string, parent: string): boolean {
  for (let p: string | undefined = parent; p; p = parentOf.get(p)) if (p === id) return true;
  return false;
}

const rank = (m: TeamMember, leadId: string | undefined) => (m.id === leadId ? 0 : 1);

function byAreaThenName(a: TeamMember, b: TeamMember): number {
  if ((a.area ?? "") !== (b.area ?? "")) {
    if (!a.area) return 1;
    if (!b.area) return -1;
    return a.area.localeCompare(b.area);
  }
  return a.name.localeCompare(b.name);
}

function groupsOf<T extends { area: string | undefined }>(items: T[]): Array<{ area: string | undefined; items: T[] }> {
  const out: Array<{ area: string | undefined; items: T[] }> = [];
  for (const it of items) {
    const last = out.at(-1);
    if (last && last.area === it.area) last.items.push(it);
    else out.push({ area: it.area, items: [it] });
  }
  return out;
}

/** Ids on the way from a node up to its root, and its direct children: the branch to light up on hover. */
export function branchOf(layout: TeamLayout, id: string): Set<string> {
  const up = new Map(layout.edges.map((e) => [e.to, e.from]));
  const out = new Set([id]);
  for (let p = up.get(id); p; p = up.get(p)) out.add(p);
  for (const e of layout.edges) if (e.from === id) out.add(e.to);
  return out;
}
