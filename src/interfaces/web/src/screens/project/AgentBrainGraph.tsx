import { useEffect, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation,
} from "d3-force";
import { t } from "../../i18n";

// Animated relational "brain" graph (d3-force + SVG), inspired by panda's
// AgentBrainGraphCanvas. Center = agent; items are real project data
// (memory facts, threads, tasks, heartbeats, hierarchy) with semantic edges.

export interface BrainNode {
  id: string;
  label: string;
  kind: "agent" | "memory" | "thread" | "task" | "routine" | "agentlink";
  relation: string;
  detail?: string;
}

interface SimNode extends BrainNode {
  x?: number; y?: number; vx?: number; vy?: number;
  fx?: number | null; fy?: number | null;
}
interface SimLink { source: SimNode; target: SimNode; }

const KIND_COLOR: Record<BrainNode["kind"], string> = {
  agent: "#a78bfa", memory: "#38bdf8", thread: "#34d399",
  task: "#fbbf24", routine: "#f472b6", agentlink: "#c084fc",
};
function kindLabels(): Record<BrainNode["kind"], string> {
  return {
    agent: t("agents_ui.kind_agent"), memory: t("agents_ui.kind_memory"), thread: t("agents_ui.kind_thread"),
    task: t("agents_ui.kind_task"), routine: t("agents_ui.kind_routine"), agentlink: t("agents_ui.kind_hierarchy"),
  };
}

const W = 760, H = 460;

export function AgentBrainGraph({ center, nodes }: { center: string; nodes: BrainNode[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const dragRef = useRef<SimNode | null>(null);
  const [, setVersion] = useState(0);
  const [selected, setSelected] = useState<BrainNode | null>(null);

  useEffect(() => {
    const centerNode: SimNode = { id: "__center", label: center, kind: "agent", relation: "self", x: W / 2, y: H / 2, fx: W / 2, fy: H / 2 };
    const simNodes: SimNode[] = [centerNode, ...nodes.map((n) => ({ ...n }))];
    const links: SimLink[] = simNodes.slice(1).map((n) => ({ source: centerNode, target: n }));
    nodesRef.current = simNodes;
    linksRef.current = links;

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(links).distance(120).strength(0.5))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(W / 2, H / 2).strength(0.05))
      .force("collide", forceCollide(26))
      .on("tick", () => setVersion((v) => v + 1));
    simRef.current = sim;
    return () => { sim.stop(); };
  }, [center, nodes]);

  const toSvg = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };
  const onDown = (n: SimNode) => (e: React.PointerEvent) => {
    if (n.id === "__center") return;
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

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-muted/10">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-[460px] w-full touch-none select-none"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {links.map((l, i) => (
            <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
              stroke={KIND_COLOR[l.target.kind]} strokeOpacity={0.22} strokeWidth={1.5} />
          ))}
          {simNodes.map((n) => {
            if (n.id === "__center") {
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                  <circle r={22} fill={KIND_COLOR.agent} />
                  <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill="#1a1a1a">
                    {center.length > 8 ? center.slice(0, 8) : center}
                  </text>
                </g>
              );
            }
            const isSel = selected?.id === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} className="cursor-grab active:cursor-grabbing"
                 onPointerDown={onDown(n)} onClick={() => setSelected(n)}>
                <circle r={isSel ? 9 : 6} fill={KIND_COLOR[n.kind]} fillOpacity={isSel ? 1 : 0.9}
                  stroke={isSel ? "#fff" : "none"} strokeWidth={isSel ? 2 : 0} />
                <text x={10} y={4} fontSize={10} className="fill-foreground/80">
                  {n.label.length > 22 ? `${n.label.slice(0, 22)}…` : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-fg">
        {(() => {
          const labels = kindLabels();
          return (Object.keys(labels) as BrainNode["kind"][]).filter((k) => k !== "agent").map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {labels[k]}
            </span>
          ));
        })()}
        <span className="ml-auto">{t("agents_ui.nodes_drag_hint", { n: String(nodes.length) })}</span>
      </div>
      {selected && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[selected.kind] }} />
            <span className="font-medium">{selected.label}</span>
            <span className="text-muted-fg">· {selected.relation}</span>
          </div>
          {selected.detail && <p className="mt-1 whitespace-pre-wrap text-muted-fg">{selected.detail}</p>}
        </div>
      )}
    </div>
  );
}
