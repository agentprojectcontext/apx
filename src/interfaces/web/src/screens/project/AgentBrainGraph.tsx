import { useEffect, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type Simulation,
} from "d3-force";
import { t } from "../../i18n";

// Generic animated "brain" graph (d3-force + SVG). It takes an explicit node +
// edge set so callers can model *any* topology — a single agent's hubbed brain
// (Memory / Threads / Tasks / Routines / Team + cross-links) or the whole
// project's agent map (orchestrators with their specialists as satellites).
//
// Motion is SMIL/CSS driven (breathing halos, a pulsing core, energy beads
// flowing down the edges) so the graph stays alive without React re-renders;
// d3 only drives layout.

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

export function BrainGraph({
  nodes, edges, height = 460, onNodeClick,
}: {
  nodes: BrainNode[];
  edges: BrainEdge[];
  height?: number;
  onNodeClick?: (n: BrainNode) => void;
}) {
  const W = 760, H = height;
  const CX = W / 2, CY = H / 2;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const dragRef = useRef<SimNode | null>(null);
  const [, setVersion] = useState(0);
  const [selected, setSelected] = useState<BrainNode | null>(null);

  const hideLeafLabels = nodes.length > 44;

  useEffect(() => {
    // Seed positions so the first paint already looks like a graph (no blank
    // flash, and a sane starting layout for d3).
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
    setVersion((v) => v + 1); // commit the seeded layout even if the tick timer is throttled

    const linkDist = (l: SimLink) => {
      const ra = roleOf(l.source), rb = roleOf(l.target);
      if (ra === "core" || rb === "core") return 150;
      if (ra === "hub" && rb === "hub") return 120;
      return 62;
    };
    const charge = (n: SimNode) => {
      const r = roleOf(n);
      return r === "core" ? -620 : r === "hub" ? -320 : -110;
    };

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(links).distance(linkDist).strength(0.55))
      .force("charge", forceManyBody<SimNode>().strength(charge))
      .force("center", forceCenter(CX, CY).strength(0.04))
      .force("x", forceX(CX).strength(0.03))
      .force("y", forceY(CY).strength(0.03))
      .force("collide", forceCollide<SimNode>((n) => RADIUS[roleOf(n)] + 8))
      .alphaDecay(0.028)
      .on("tick", () => setVersion((v) => v + 1));
    simRef.current = sim;
    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, height]);

  const toSvg = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };
  const onDown = (n: SimNode) => (e: React.PointerEvent) => {
    if (roleOf(n) === "core") return;
    dragRef.current = n;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    simRef.current?.alphaTarget(0.3).restart();
  };
  const onMove = (e: React.PointerEvent) => {
    const n = dragRef.current;
    if (!n) return;
    const { x, y } = toSvg(e);
    n.fx = x; n.fy = y;
  };
  const onUp = () => {
    const n = dragRef.current;
    if (n) { n.fx = null; n.fy = null; }
    dragRef.current = null;
    simRef.current?.alphaTarget(0);
  };

  const simNodes = nodesRef.current;
  const links = linksRef.current;

  // Legend: the item kinds actually present (exclude the core agent + structural hubs).
  const legendKinds = [...new Set(nodes.map((n) => n.kind))].filter((k) => k !== "agent" && k !== "hub");

  const pick = (n: SimNode) => { setSelected(n); onNodeClick?.(n); };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-b from-background to-muted/20">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ height }}
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

          <rect x={0} y={0} width={W} height={H} fill="url(#brain-bg)" />

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
                 onPointerDown={onDown(n)} onClick={() => pick(n)}>
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
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-fg">
        {legendKinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {kindLabel(k)}
          </span>
        ))}
        <span className="ml-auto">{t("agents_ui.nodes_drag_hint", { n: String(nodes.length) })}</span>
      </div>
      {selected && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[selected.kind] }} />
            {selected.emoji && <span>{selected.emoji}</span>}
            <span className="font-medium">{selected.label}</span>
            {selected.relation && <span className="text-muted-fg">· {selected.relation}</span>}
          </div>
          {selected.detail && <p className="mt-1 whitespace-pre-wrap text-muted-fg">{selected.detail}</p>}
        </div>
      )}
    </div>
  );
}
