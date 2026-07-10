import { useEffect, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type Simulation,
} from "d3-force";
import { Maximize2, Minimize2, Plus, Minus, Frame } from "lucide-react";
import { t } from "../../i18n";

// Generic animated "brain" graph (d3-force + SVG). It takes an explicit node +
// edge set so callers can model *any* topology — a single agent's hubbed brain
// (Memory / Threads / Tasks / Routines / Team + cross-links) or the whole
// project's agent map (each agent expanded into its own connected sub-brain).
//
// Motion is SMIL/CSS driven (breathing halos, a pulsing core, energy beads
// flowing down the edges) so the graph stays alive without React re-renders;
// d3 only drives layout. The view supports wheel-zoom, background pan, a
// fit-to-content button and fullscreen.

export type BrainKind =
  | "agent" | "memory" | "thread" | "task" | "routine" | "agentlink" | "hub";
export type BrainRole = "core" | "hub" | "leaf";

export interface BrainNode {
  id: string;
  label: string;
  kind: BrainKind;
  role?: BrainRole;       // visual weight; defaults to "leaf"
  relation?: string;
  detail?: string;
  emoji?: string;
  slug?: string;          // for navigation (project map)
}
export interface BrainEdge { source: string; target: string; }

interface SimNode extends BrainNode {
  x?: number; y?: number; vx?: number; vy?: number;
  fx?: number | null; fy?: number | null;
}
interface SimLink { source: SimNode; target: SimNode; }

const KIND_COLOR: Record<BrainKind, string> = {
  agent: "#a78bfa", memory: "#38bdf8", thread: "#34d399",
  task: "#fbbf24", routine: "#f472b6", agentlink: "#c084fc", hub: "#94a3b8",
};
function kindLabel(k: BrainKind): string {
  const m: Record<string, string> = {
    agent: t("agents_ui.kind_agent"), memory: t("agents_ui.kind_memory"), thread: t("agents_ui.kind_thread"),
    task: t("agents_ui.kind_task"), routine: t("agents_ui.kind_routine"), agentlink: t("agents_ui.kind_hierarchy"),
  };
  return m[k] ?? k;
}

const RADIUS: Record<BrainRole, number> = { core: 24, hub: 12, leaf: 6 };
const roleOf = (n: BrainNode): BrainRole => n.role ?? "leaf";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uniqById = <T extends { id: string }>(arr: T[]): T[] => {
  const m = new Map<string, T>();
  for (const n of arr) m.set(n.id, n);
  return [...m.values()];
};
const clip = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function BrainGraph({
  nodes, edges, height = 520, onNodeClick, toolbar,
}: {
  nodes: BrainNode[];
  edges: BrainEdge[];
  height?: number;
  onNodeClick?: (n: BrainNode) => void;
  toolbar?: React.ReactNode;   // extra controls (e.g. an Expand toggle)
}) {
  const W = 1000, H = Math.round((W * height) / 760); // keep a wide-ish canvas

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const dragRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // Press bookkeeping so a drag is never mistaken for a click (which navigates).
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const viewRef = useRef({ tx: 0, ty: 0, k: 1 });
  const fitRef = useRef<() => void>(() => {});
  const [, setVersion] = useState(0);
  const [selected, setSelected] = useState<BrainNode | null>(null);
  const [fs, setFs] = useState(false);

  const CX = W / 2, CY = H / 2;
  const bump = () => setVersion((v) => v + 1);
  const hideLeafLabels = nodes.length > 44;

  // ── Layout simulation ──────────────────────────────────────────────────────
  useEffect(() => {
    const coreR = Math.min(W, H) * 0.30;
    const hubs = nodes.filter((n) => roleOf(n) === "hub");
    const hubAngle = new Map<string, number>();
    hubs.forEach((h, i) => hubAngle.set(h.id, (i / Math.max(1, hubs.length)) * Math.PI * 2 - Math.PI / 2));

    const simNodes: SimNode[] = nodes.map((n, i) => {
      const role = roleOf(n);
      if (role === "core") return { ...n, x: CX, y: CY, fx: CX, fy: CY };
      const a = hubAngle.get(n.id) ?? (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const r = role === "hub" ? coreR : coreR * 1.7;
      return { ...n, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const links: SimLink[] = edges
      .map((e) => ({ source: byId.get(e.source), target: byId.get(e.target) }))
      .filter((l): l is SimLink => !!l.source && !!l.target);

    nodesRef.current = simNodes;
    linksRef.current = links;
    bump();

    const linkDist = (l: SimLink) => {
      const ra = roleOf(l.source), rb = roleOf(l.target);
      if (ra === "core" || rb === "core") return 170;
      if (ra === "hub" && rb === "hub") return 130;
      return 58;
    };
    const charge = (n: SimNode) => {
      const r = roleOf(n);
      return r === "core" ? -700 : r === "hub" ? -360 : -90;
    };

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(links).distance(linkDist).strength(0.5))
      .force("charge", forceManyBody<SimNode>().strength(charge))
      .force("center", forceCenter(CX, CY).strength(0.03))
      .force("x", forceX(CX).strength(0.02))
      .force("y", forceY(CY).strength(0.02))
      .force("collide", forceCollide<SimNode>((n) => RADIUS[roleOf(n)] + 8))
      .alphaDecay(0.025)
      .on("tick", bump);
    simRef.current = sim;
    // Auto-fit once the layout has cooled a little.
    const fit = setTimeout(() => fitRef.current(), 1400);
    return () => { clearTimeout(fit); sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, height]);

  // ── View helpers (pan / zoom / fit) ────────────────────────────────────────
  const svgPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  };
  const zoomAround = (sx: number, sy: number, factor: number) => {
    const v = viewRef.current;
    const k = clamp(v.k * factor, 0.25, 8);
    viewRef.current = { k, tx: sx - (sx - v.tx) * (k / v.k), ty: sy - (sy - v.ty) * (k / v.k) };
    bump();
  };
  fitRef.current = () => {
    const ns = nodesRef.current.filter((n) => n.x != null && n.y != null);
    if (!ns.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) { minX = Math.min(minX, n.x!); minY = Math.min(minY, n.y!); maxX = Math.max(maxX, n.x!); maxY = Math.max(maxY, n.y!); }
    const pad = 60;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const k = clamp(Math.min((W - pad * 2) / bw, (H - pad * 2) / bh), 0.25, 2.5);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    viewRef.current = { k, tx: W / 2 - cx * k, ty: H / 2 - cy * k };
    bump();
  };

  // Native non-passive wheel so we can preventDefault the page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = svgPoint(e.clientX, e.clientY);
      zoomAround(p.x, p.y, e.deltaY > 0 ? 0.9 : 1.1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape exits fullscreen.
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFs(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);

  // ── Pointer interaction: node drag OR background pan ────────────────────────
  const worldFromClient = (clientX: number, clientY: number) => {
    const p = svgPoint(clientX, clientY);
    const v = viewRef.current;
    return { x: (p.x - v.tx) / v.k, y: (p.y - v.ty) / v.k };
  };
  const onNodeDown = (n: SimNode) => (e: React.PointerEvent) => {
    if (roleOf(n) === "core") return;
    e.stopPropagation();
    dragRef.current = n;
    downRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    simRef.current?.alphaTarget(0.3).restart();
  };
  const onBgDown = (e: React.PointerEvent) => {
    panRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const d = downRef.current;
      if (d && !movedRef.current && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) movedRef.current = true;
      const w = worldFromClient(e.clientX, e.clientY);
      dragRef.current.fx = w.x; dragRef.current.fy = w.y;
      return;
    }
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      viewRef.current.tx += ((e.clientX - panRef.current.x) / rect.width) * W;
      viewRef.current.ty += ((e.clientY - panRef.current.y) / rect.height) * H;
      panRef.current = { x: e.clientX, y: e.clientY };
      bump();
    }
  };
  const onUp = () => {
    const n = dragRef.current;
    if (n) { n.fx = null; n.fy = null; }
    dragRef.current = null;
    panRef.current = null;
    simRef.current?.alphaTarget(0);
  };
  // Native click fires reliably on pointerup; skip it when the press was a drag.
  const onNodeClickGuarded = (n: SimNode) => () => { if (!movedRef.current) pick(n); };

  const simNodes = nodesRef.current;
  const links = linksRef.current;
  const v = viewRef.current;
  const legendKinds = [...new Set(nodes.map((n) => n.kind))].filter((k) => k !== "agent" && k !== "hub");
  const pick = (n: SimNode) => { setSelected(n); onNodeClick?.(n); };

  // For the detail panel: what the selected node hangs off (parents) and the
  // branches that hang off it (children), derived from the live edges.
  const selParents = selected ? uniqById(links.filter((l) => l.target.id === selected.id).map((l) => l.source)) : [];
  const selChildren = selected ? uniqById(links.filter((l) => l.source.id === selected.id).map((l) => l.target)) : [];
  // The detail line is only meaningful when it adds something beyond the title.
  const selDetail = selected?.detail && selected.detail.trim() !== selected.label.trim() ? selected.detail : null;

  const CtrlBtn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} onClick={onClick}
      className="grid size-7 place-items-center rounded-md border border-border bg-card/80 text-muted-fg backdrop-blur hover:text-foreground">
      {children}
    </button>
  );

  return (
    <div className="space-y-3">
      <div
        ref={wrapRef}
        className={fs
          ? "fixed inset-0 z-[60] flex flex-col gap-3 bg-background p-4"
          : "relative"}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-gradient-to-b from-background to-muted/20">
          {/* Controls */}
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
            {toolbar}
            <CtrlBtn onClick={() => zoomAround(CX, CY, 1.2)} title={t("agents_ui.brain_zoom_in")}><Plus size={14} /></CtrlBtn>
            <CtrlBtn onClick={() => zoomAround(CX, CY, 0.83)} title={t("agents_ui.brain_zoom_out")}><Minus size={14} /></CtrlBtn>
            <CtrlBtn onClick={() => fitRef.current()} title={t("agents_ui.brain_fit")}><Frame size={14} /></CtrlBtn>
            <CtrlBtn onClick={() => setFs((f) => !f)} title={t(fs ? "agents_ui.brain_exit_fs" : "agents_ui.brain_fullscreen")}>
              {fs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </CtrlBtn>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={fs ? { height: "100%", width: "100%" } : { height }}
            className="w-full touch-none select-none"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <filter id="brain-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <radialGradient id="brain-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={KIND_COLOR.agent} stopOpacity="0.9" />
                <stop offset="55%" stopColor={KIND_COLOR.agent} stopOpacity="0.35" />
                <stop offset="100%" stopColor={KIND_COLOR.agent} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="brain-bg" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor={KIND_COLOR.agent} stopOpacity="0.10" />
                <stop offset="100%" stopColor={KIND_COLOR.agent} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Background — also the pan surface */}
            <rect x={0} y={0} width={W} height={H} fill="url(#brain-bg)" onPointerDown={onBgDown} className="cursor-grab active:cursor-grabbing" />

            <g transform={`translate(${v.tx},${v.ty}) scale(${v.k})`}>
              {/* Edges: faint spine + a bead of energy flowing along it */}
              {links.map((l, i) => {
                const color = KIND_COLOR[l.target.kind === "hub" ? l.source.kind : l.target.kind];
                const dur = 1.4 + (i % 5) * 0.35;
                return (
                  <g key={i}>
                    <line x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
                      stroke={color} strokeOpacity={0.16} strokeWidth={1.4} />
                    <line x1={l.target.x} y1={l.target.y} x2={l.source.x} y2={l.source.y}
                      stroke={color} strokeOpacity={0.5} strokeWidth={2}
                      strokeLinecap="round" strokeDasharray="1 14">
                      <animate attributeName="stroke-dashoffset" values="15;0" dur={`${dur}s`} repeatCount="indefinite" />
                    </line>
                  </g>
                );
              })}

              {/* Nodes */}
              {simNodes.map((n, idx) => {
                const role = roleOf(n);
                const color = KIND_COLOR[n.kind];
                if (role === "core") {
                  const display = (n.emoji && n.emoji.trim()) || n.label.slice(0, 2).toUpperCase();
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                      <circle r={54} fill="url(#brain-core)">
                        <animate attributeName="r" values="50;58;50" dur="4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.85;1;0.85" dur="4s" repeatCount="indefinite" />
                      </circle>
                      <circle r={26} fill="none" stroke={KIND_COLOR.agent} strokeWidth={1.5} opacity={0.5}>
                        <animate attributeName="r" values="26;48" dur="3.2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.5;0" dur="3.2s" repeatCount="indefinite" />
                      </circle>
                      <circle r={24} fill={KIND_COLOR.agent} filter="url(#brain-glow)" />
                      <circle r={24} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1} />
                      <text textAnchor="middle" dominantBaseline="central" fontSize={display.length <= 2 ? 20 : 11} fontWeight={700} fill="#1a1030">
                        {display.length > 8 ? display.slice(0, 8) : display}
                      </text>
                    </g>
                  );
                }
                const isSel = selected?.id === n.id;
                const r = RADIUS[role] + (isSel ? 3 : 0);
                const beat = 2.4 + (idx % 6) * 0.4;
                const begin = `${(idx % 6) * 0.3}s`;
                const isHub = role === "hub";
                const showLabel = isHub || isSel || !hideLeafLabels;
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} className="cursor-grab active:cursor-grabbing"
                     onPointerDown={onNodeDown(n)} onClick={onNodeClickGuarded(n)}>
                    <circle r={r} fill={color} filter="url(#brain-glow)" opacity={0.3}>
                      <animate attributeName="r" values={`${r};${r + 6};${r}`} dur={`${beat}s`} begin={begin} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.32;0.08;0.32" dur={`${beat}s`} begin={begin} repeatCount="indefinite" />
                    </circle>
                    <circle r={r} fill={color} fillOpacity={isSel ? 1 : 0.95}
                      stroke={isSel ? "#fff" : "#ffffff"} strokeOpacity={isSel ? 1 : 0.25} strokeWidth={isSel ? 2 : 1} />
                    {n.emoji && isHub && (
                      <text textAnchor="middle" dominantBaseline="central" fontSize={11} style={{ pointerEvents: "none" }}>{n.emoji}</text>
                    )}
                    {showLabel && (
                      <text x={r + 4} y={4} fontSize={isHub ? 11 : 10}
                        className={isHub ? "fill-foreground font-medium" : "fill-foreground/80"} style={{ pointerEvents: "none" }}>
                        {n.label.length > 22 ? `${n.label.slice(0, 22)}…` : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Legend + hint (kept inside the fullscreen container too) */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-fg">
          {legendKinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {kindLabel(k)}
            </span>
          ))}
          <span className="ml-auto">{t("agents_ui.brain_pan_hint")} · {t("agents_ui.nodes_drag_hint", { n: String(nodes.length) })}</span>
        </div>
      </div>

      {selected && (
        <div className="space-y-2.5 rounded-lg border border-border bg-card p-3 text-xs">
          {/* The clicked node: title, type, relation */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: KIND_COLOR[selected.kind] }} />
            {selected.emoji && <span className="text-sm leading-none">{selected.emoji}</span>}
            <span className="text-[13px] font-semibold">{selected.label}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-fg">
              {kindLabel(selected.kind)}
            </span>
            {selected.relation && <span className="text-muted-fg">· {selected.relation}</span>}
            <div className="ml-auto flex items-center gap-2">
              {selected.slug && onNodeClick && (
                <button type="button" onClick={() => onNodeClick(selected)} className="text-primary hover:underline">
                  {t("agents_ui.brain_open")}
                </button>
              )}
              <button type="button" onClick={() => setSelected(null)} className="text-muted-fg hover:text-foreground">✕</button>
            </div>
          </div>

          {/* Internal info — only when it adds something beyond the title */}
          {selDetail && <p className="whitespace-pre-wrap text-muted-fg">{selDetail}</p>}

          {/* Where it hangs from */}
          {selParents.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-fg/70">{t("agents_ui.brain_part_of")}</span>
              {selParents.map((p) => <NeighborChip key={p.id} node={p} onClick={() => setSelected(p)} />)}
            </div>
          )}

          {/* Branches that follow it */}
          {selChildren.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-fg/70">
                {t("agents_ui.brain_branches")} · {selChildren.length}
              </span>
              {selChildren.map((c) => <NeighborChip key={c.id} node={c} onClick={() => setSelected(c)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A clickable chip for a connected node in the detail panel.
function NeighborChip({ node, onClick }: { node: BrainNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] hover:border-muted-fg/50 hover:bg-muted"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[node.kind] }} />
      {node.emoji && <span className="leading-none">{node.emoji}</span>}
      <span className="truncate">{clip(node.label, 28)}</span>
    </button>
  );
}
