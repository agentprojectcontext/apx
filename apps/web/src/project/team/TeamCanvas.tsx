import type { Agent } from "@apx/protocol";
import { AgentNode, type AgentNodeStat, IconButton, Icons } from "@apx/ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { blobOf } from "../../data/identity.ts";
import { useT } from "../../i18n/index.ts";
import { branchOf, layoutTeam, NODE } from "./teamLayout.ts";

export type NodeInfo = {
  status: "idle" | "running" | "waiting";
  stats: AgentNodeStat[];
  engine: string;
  engineLabel: string;
  lead?: string;
};

/** A few tones that read in both modes; an area keeps its tone wherever it appears. */
const TONES = 6;
const toneOf = (area: string | undefined) =>
  area ? [...area].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES : -1;

const ZOOMS = [0.35, 0.5, 0.65, 0.8, 1, 1.15] as const;

/**
 * The team as an org chart: cards on a dotted canvas, soft curves from each parent to its children, a pill per area
 * on the elbow, and a dot that travels down a curve while one agent is asking another for something.
 */
export function TeamCanvas({
  agents,
  leadId,
  info,
  live,
  selected,
  onOpen,
  onChat,
}: {
  agents: Agent[];
  leadId: string | undefined;
  info: (a: Agent) => NodeInfo;
  /** "from>to" agent id pairs with a delegation in flight. */
  live: Set<string>;
  selected: string | undefined;
  onOpen(a: Agent): void;
  onChat(a: Agent): void;
}) {
  const t = useT();
  const layout = useMemo(() => layoutTeam(agents, leadId), [agents, leadId]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [hover, setHover] = useState<string>();
  const lit = hover ? branchOf(layout, hover) : undefined;
  const pad = 32;
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;

  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(false);
  // Start fitted to the width when the tree is wider than the screen; the owner can zoom from there.
  useLayoutEffect(() => {
    if (fitted || !box.current) return;
    const avail = box.current.clientWidth;
    if (avail > 0 && W > avail) setZoom(Math.max(ZOOMS[0], Math.min(1, avail / W)));
    setFitted(true);
  }, [W, fitted]);
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    setZoom(next ?? 1);
  };
  const fit = () => {
    const avail = box.current?.clientWidth ?? W;
    setZoom(Math.max(ZOOMS[0], Math.min(1, avail / W)));
  };

  return (
    <div className="teamcanvas" ref={box}>
      <div className="teamcanvas__scroll">
        <div className="teamcanvas__sizer" style={{ width: W * zoom, height: H * zoom }}>
          <div className="teamcanvas__stage" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
            <svg className="teamcanvas__edges" width={W} height={H} aria-hidden="true">
              {layout.edges.map((e) => {
                const a = layout.nodes.find((n) => n.id === e.from);
                const b = layout.nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const x1 = pad + a.x + NODE.w / 2;
                const y1 = pad + a.y + NODE.h;
                const x2 = pad + b.x + NODE.w / 2;
                const y2 = pad + b.y;
                const mid = (y1 + y2) / 2;
                const d = `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
                const on = live.has(`${e.from}>${e.to}`);
                const dim = lit && !(lit.has(e.from) && lit.has(e.to));
                const cls = [
                  "teamcanvas__edge",
                  `tone-${toneOf(e.area)}`,
                  on && "is-live",
                  lit && !dim && "is-lit",
                  dim && "is-dim",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <g key={`${e.from}>${e.to}`} className={cls}>
                    <path d={d} className="teamcanvas__line" />
                    {on && (
                      <circle r="4" className="teamcanvas__pulse">
                        <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>
            {layout.pills.map((p) => (
              <span
                key={`${p.parent}:${p.area}`}
                className={`teamcanvas__pill tone-${toneOf(p.area)}`}
                style={{ left: pad + p.x, top: pad + p.y }}
              >
                {p.area} · {p.count}
              </span>
            ))}
            {layout.nodes.map((n) => {
              const a = byId.get(n.id);
              if (!a) return null;
              const i = info(a);
              return (
                <div
                  key={n.id}
                  className="teamcanvas__node"
                  style={{ left: pad + n.x, top: pad + n.y, width: NODE.w, height: NODE.h }}
                >
                  <AgentNode
                    name={a.name}
                    {...(a.slug || a.id ? { slug: a.slug ?? a.id } : {})}
                    {...(blobOf(a) ? { blob: blobOf(a) } : {})}
                    {...(a.role ? { role: a.role } : {})}
                    {...(a.description ? { description: a.description } : {})}
                    {...(i.lead ? { lead: i.lead } : {})}
                    engine={i.engine}
                    engineLabel={i.engineLabel}
                    stats={i.stats}
                    status={i.status}
                    selected={selected === a.id}
                    dimmed={Boolean(lit && !lit.has(a.id))}
                    viewLabel={t("team.view.open")}
                    chatLabel={t("team.chat")}
                    waitingLabel={t("team.waiting")}
                    onOpen={() => onOpen(a)}
                    onChat={() => onChat(a)}
                    onHover={(on) => setHover(on ? a.id : undefined)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="teamcanvas__zoom" role="toolbar" aria-label={t("team.zoom")}>
        <IconButton size="sm" label={t("team.zoomOut")} icon={<Icons.Minus size={14} />} onClick={() => step(-1)} />
        <span className="teamcanvas__zoomval">{Math.round(zoom * 100)}%</span>
        <IconButton size="sm" label={t("team.zoomIn")} icon={<Icons.Plus size={14} />} onClick={() => step(1)} />
        <IconButton size="sm" label={t("team.fit")} icon={<Icons.Maximize2 size={14} />} onClick={fit} />
      </div>
    </div>
  );
}
