// The Team view's tree: who reports to whom, laid out top-down with each parent centred over its children, and
// siblings grouped by area. Pure (no React, no DOM) so it is tested on its own.

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

/**
 * Parents come from `parent:` (a slug of the same team; a global agent, which has none, is named by its id). Anyone
 * else hangs under `leadId` when given, so the team is one tree like an org chart; a loop in `parent:` is broken where
 * it closes.
 */
export function layoutTeam(members: TeamMember[], leadId?: string): TeamLayout {
  const bySlug = new Map(members.map((m) => [m.slug ?? m.id, m] as const));
  const parentOf = new Map<string, string>();
  for (const m of members) {
    const p = m.parent ? bySlug.get(m.parent) : undefined;
    const parent = p && p.id !== m.id ? p.id : m.id !== leadId ? leadId : undefined;
    if (parent && !closesLoop(parentOf, m.id, parent)) parentOf.set(m.id, parent);
  }
  const children = new Map<string, TeamMember[]>();
  for (const m of members) {
    const p = parentOf.get(m.id);
    if (p) children.set(p, [...(children.get(p) ?? []), m]);
  }
  for (const list of children.values()) list.sort(byAreaThenName);
  const roots = members.filter((m) => !parentOf.has(m.id)).sort((a, b) => rank(a, leadId) - rank(b, leadId));

  const width = new Map<string, number>();
  const bands = new Map<string, Band[]>();
  const measure = (m: TeamMember): number => {
    const kids = children.get(m.id) ?? [];
    // Many direct reports, none leading a team: blocks by area, packed in bands under the parent.
    if (kids.length > BAND_AT && kids.every((k) => !children.get(k.id)?.length)) {
      const plan = bandsOf(kids);
      bands.set(m.id, plan);
      const w = Math.max(NODE.w, ...plan.map((b) => b.width));
      width.set(m.id, w);
      for (const k of kids) width.set(k.id, NODE.w);
      return w;
    }
    const w = Math.max(NODE.w, kids.reduce((sum, k) => sum + measure(k), 0) + NODE.gapX * Math.max(0, kids.length - 1));
    width.set(m.id, w);
    return w;
  };

  const nodes: PlacedNode[] = [];
  const edges: Edge[] = [];
  const pills: AreaPill[] = [];
  const place = (m: TeamMember, x0: number, y: number, depth: number) => {
    const w = width.get(m.id) ?? NODE.w;
    nodes.push({ id: m.id, x: x0 + (w - NODE.w) / 2, y, depth });
    const kids = children.get(m.id) ?? [];
    const plan = bands.get(m.id);
    if (plan) {
      let by = y + NODE.h + NODE.gapY;
      for (const band of plan) {
        let bx = x0 + (w - band.width) / 2;
        for (const g of band.groups) {
          g.members.forEach((k, i) => {
            const col = i % g.cols;
            const row = Math.floor(i / g.cols);
            nodes.push({
              id: k.id,
              x: bx + col * (NODE.w + NODE.gapX),
              y: by + row * (NODE.h + ROW_GAP),
              depth: depth + 1,
            });
            edges.push({ from: m.id, to: k.id, area: k.area });
          });
          if (g.area)
            pills.push({
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
      return;
    }
    const total = kids.reduce((s, k) => s + (width.get(k.id) ?? NODE.w), 0) + NODE.gapX * Math.max(0, kids.length - 1);
    let x = x0 + (w - total) / 2;
    const centres: Array<{ area: string | undefined; cx: number }> = [];
    for (const k of kids) {
      const kw = width.get(k.id) ?? NODE.w;
      centres.push({ area: k.area, cx: x + kw / 2 });
      edges.push({ from: m.id, to: k.id, area: k.area });
      place(k, x, y + NODE.h + NODE.gapY, depth + 1);
      x += kw + NODE.gapX;
    }
    for (const group of groupsOf(centres)) {
      if (!group.area) continue;
      const first = group.items[0]?.cx ?? 0;
      const last = group.items.at(-1)?.cx ?? first;
      pills.push({
        parent: m.id,
        area: group.area,
        count: group.items.length,
        x: (first + last) / 2,
        y: y + NODE.h + NODE.gapY / 2,
      });
    }
  };

  for (const r of roots) measure(r);
  let x = 0;
  for (const r of roots) {
    place(r, x, 0, 0);
    x += (width.get(r.id) ?? NODE.w) + NODE.gapX * 2;
  }
  return {
    nodes,
    edges,
    pills,
    width: Math.max(NODE.w, x - NODE.gapX * 2),
    height: nodes.length ? Math.max(...nodes.map((n) => n.y)) + NODE.h : 0,
  };
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
