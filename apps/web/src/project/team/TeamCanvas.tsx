import type { Agent } from "@apx/protocol";
import { AgentNode, type AgentNodeStat, ContextMenu, IconButton, Icons, type MenuEntry } from "@apx/ui";
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
  /** Fallback copy for the super-agent when it has no description of its own. */
  superDesc?: string;
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
  menu,
  areaName = (slug) => slug,
}: {
  agents: Agent[];
  leadId: string | undefined;
  info: (a: Agent) => NodeInfo;
  /** "from>to" agent id pairs with a delegation in flight. */
  live: Set<string>;
  selected: string | undefined;
  onOpen(a: Agent): void;
  onChat(a: Agent): void;
  /** A card's right-click menu. */
  menu(a: Agent): MenuEntry[];
  /** An area's name for its pill (the project's areas), its slug when it has none. */
  areaName?: (slug: string) => string;
}) {
  const t = useT();
  const layout = useMemo(() => layoutTeam(agents, leadId), [agents, leadId]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [hover, setHover] = useState<string>();
  // A card that went away while hovered (agent removed, a dialog took the pointer) must not keep the rest dimmed.
  const hovered = hover && layout.nodes.some((n) => n.id === hover) ? hover : undefined;
  const lit = hovered ? branchOf(layout, hovered) : undefined;
  const pad = 32;
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;

  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The width the tree can use: the scroller's inside, so fitting never leaves a horizontal scrollbar. */
  const room = () => scroller.current?.clientWidth ?? box.current?.clientWidth ?? W;
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(false);
  // Start fitted to the width when the tree is wider than the screen; the owner can zoom from there.
  useLayoutEffect(() => {
    if (fitted || !box.current) return;
    const avail = scroller.current?.clientWidth ?? box.current.clientWidth;
    if (avail > 0 && W > avail) setZoom(Math.max(ZOOMS[0], Math.min(1, avail / W)));
    setFitted(true);
  }, [W, fitted]);
  // In: the first step above the current zoom; out: the last one below it (a fitted zoom sits between steps).
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    if (next) setZoom(next);
  };
  const fit = () => setZoom(Math.max(ZOOMS[0], Math.min(1, room() / W)));
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const curve = (from: string, to: string) => {
    const a = at.get(from);
    const b = at.get(to);
    if (!a || !b) return undefined;
    const x1 = pad + a.x + NODE.w / 2;
    const y1 = pad + a.y + (b.y > a.y ? NODE.h : 0);
    const x2 = pad + b.x + NODE.w / 2;
    const y2 = pad + b.y + (b.y > a.y ? 0 : NODE.h);
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
  };
  // Delegations that do not follow a parent→child curve (upwards, sideways, skipping a level) get a curve of their own.
  const tree = new Set(layout.edges.map((e) => `${e.from}>${e.to}`));
  const extra = [...live].filter((k) => !tree.has(k)).map((k) => k.split(">") as [string, string]);

  return (
    <div className="teamcanvas" ref={box}>
      <div className="teamcanvas__scroll" ref={scroller}>
        <div className="teamcanvas__sizer" style={{ width: W * zoom, height: H * zoom }}>
          <div className="teamcanvas__stage" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
            <svg className="teamcanvas__edges" width={W} height={H} aria-hidden="true">
              {layout.edges.map((e) => {
                const d = curve(e.from, e.to);
                if (!d) return null;
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
                    {on && <Pulse d={d} />}
                  </g>
                );
              })}
              {extra.map(([from, to]) => {
                const d = curve(from, to);
                return d ? (
                  <g key={`${from}>${to}`} className="teamcanvas__edge tone-2 is-live is-extra">
                    <path d={d} className="teamcanvas__line" />
                    <Pulse d={d} />
                  </g>
                ) : null;
              })}
            </svg>
            {layout.pills.map((p) => (
              <span
                key={`${p.parent}:${p.area}`}
                className={`teamcanvas__pill tone-${toneOf(p.area)}`}
                style={{ left: pad + p.x, top: pad + p.y }}
              >
                {areaName(p.area)} · {p.count}
              </span>
            ))}
            {layout.nodes.map((n) => {
              const a = byId.get(n.id);
              if (!a) return null;
              const i = info(a);
              const own = a.description?.trim();
              const description = own || i.superDesc || t("team.noDescription");
              const descriptionEmpty = !own && !i.superDesc;
              return (
                <ContextMenu
                  key={n.id}
                  items={menu(a)}
                  render={
                    <div
                      className="teamcanvas__node"
                      style={{ left: pad + n.x, top: pad + n.y, width: NODE.w, height: NODE.h }}
                    />
                  }
                >
                  <AgentNode
                    name={a.name}
                    {...(a.slug || a.id ? { slug: a.slug ?? a.id } : {})}
                    {...(blobOf(a) ? { blob: blobOf(a) } : {})}
                    {...(a.role ? { role: a.role } : {})}
                    description={description}
                    descriptionEmpty={descriptionEmpty}
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
                </ContextMenu>
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

/** The dot that travels along a curve while a delegation is in flight. */
function Pulse({ d }: { d: string }) {
  return (
    <circle r="4" className="teamcanvas__pulse">
      <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
    </circle>
  );
}
