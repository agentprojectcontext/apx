import { FLOW_OTHERWISE } from "@apx/protocol/flow-cases";
import { FlowStep, type FlowStepState, IconButton, Icons } from "@apx/ui";
import {
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useT } from "../i18n/index.ts";
import { branchesOf, type FlowGraph, type FlowNode, isTrigger, STEP } from "./steps.tsx";
import "@xyflow/react/dist/style.css";
import "./canvas.css";

export type StepLook = {
  title: string;
  detail?: ReactNode;
  detailPlain?: boolean;
  badge?: string;
  state?: FlowStepState;
  order?: number;
  muted?: boolean;
  /** Just added or changed by an agent: marked for a moment. */
  mark?: boolean;
};
type StepData = StepLook & {
  kind: FlowNode["kind"];
  kindLabel: string;
  trigger: boolean;
  /** A check's ways out, named for the person: its cases, then otherwise. */
  branches?: { id: string; label: string }[] | undefined;
};

/** A way out of a check: a handle on the node's right, with its name when there are more than two. */
function Outlet({ id, label, top }: { id: string; label: string; top?: string }) {
  return (
    <Handle
      id={id}
      type="source"
      position={Position.Right}
      className={`fc-handle fc-handle--out ${id === FLOW_OTHERWISE ? "fc-handle--no" : "fc-handle--yes"}`}
      style={top ? { top } : undefined}
      title={label}
    />
  );
}

function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const meta = STEP[data.kind];
  return (
    <FlowStep
      icon={meta.icon}
      tone={meta.tone}
      kind={data.kindLabel}
      title={data.title}
      detail={data.detail}
      detailPlain={data.detailPlain}
      badge={data.badge}
      state={data.state}
      order={data.order}
      muted={data.muted}
      selected={selected}
      className={data.mark ? "fc-mark" : undefined}
    >
      {!data.trigger && <Handle type="target" position={Position.Left} className="fc-handle fc-handle--in" />}
      {data.branches && data.branches.length <= 2 ? (
        data.branches.map((b, i) => <Outlet key={b.id} {...b} top={i === 0 ? "32%" : "68%"} />)
      ) : data.branches ? (
        <span className="fc-outs">
          {data.branches.map((b) => (
            <span key={b.id} className={b.id === FLOW_OTHERWISE ? "fc-out is-no" : "fc-out"}>
              {b.label}
              <Outlet {...b} />
            </span>
          ))}
        </span>
      ) : (
        <Handle type="source" position={Position.Right} className="fc-handle fc-handle--out" />
      )}
    </FlowStep>
  );
}
const nodeTypes = { step: StepNode };

/**
 * Fits the view once the steps have sizes, and again when `fitKey` changes, leaving out what a card covers. On a
 * phone the whole chain would be too small to read: it shows the first steps and the rest is a pan away.
 */
function FitOnce({
  fitKey,
  first,
  cover,
  whole,
}: {
  fitKey: string;
  first: readonly string[];
  cover: Cover | undefined;
  whole?: boolean;
}) {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const narrow = useStore((s) => s.width > 0 && s.width < 600) && !whole;
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const done = useRef<string | null>(null);
  useEffect(() => {
    // A picture of the whole drawing fits again whenever its box changes size (a phone turned, a panel opened).
    const key = whole ? `${fitKey}:${width}` : fitKey;
    if (ready && done.current !== key) {
      done.current = key;
      const c = cover?.(width, height);
      const padding = c
        ? {
            top: 0.2,
            left: 0.2,
            right: `${c.right + 24}px` as const,
            bottom: c.bottom ? (`${c.bottom + 24}px` as const) : 0.2,
          }
        : 0.2;
      void fitView({ maxZoom: 1, padding, ...(narrow ? { nodes: first.map((id) => ({ id })) } : {}) });
    }
  }, [ready, fitKey, fitView, narrow, first, cover, width, height, whole]);
  return null;
}

/** The part of the canvas a card covers, so a step is centred in what stays visible. */
export type Cover = (width: number, height: number) => { right: number; bottom: number };

/** Pans, at the same zoom, so the asked step sits in the middle of the canvas left uncovered. */
function Focus({ request, cover }: { request: { id: string; seq: number } | null; cover: Cover }) {
  const { getInternalNode, getViewport, setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const size = useRef({ width, height });
  size.current = { width, height };
  // A step just added has no size yet: wait for it, then pan once per request.
  const measured = useStore((s) => (request ? (s.nodeLookup.get(request.id)?.measured.width ?? 0) : 0) > 0);
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!request || !measured || done.current === request.seq) return;
    const node = getInternalNode(request.id);
    if (!node) return;
    done.current = request.seq;
    const { width: w, height: h } = size.current;
    const { right, bottom } = cover(w, h);
    const { zoom } = getViewport();
    const x = node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2;
    const y = node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void setViewport(
      { x: (w - right) / 2 - x * zoom, y: (h - bottom) / 2 - y * zoom, zoom },
      { duration: still ? 0 : 250 },
    );
  }, [request, measured, cover, getInternalNode, getViewport, setViewport]);
  return null;
}

function Zoom() {
  const t = useT();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="fc-zoom">
      <div className="fc-zoom__buttons">
        <IconButton label={t("flow.zoomIn")} icon={<Icons.Plus size={14} />} onClick={() => void zoomIn()} />
        <IconButton label={t("flow.zoomOut")} icon={<Icons.Minus size={14} />} onClick={() => void zoomOut()} />
        <IconButton
          label={t("flow.fit")}
          icon={<Icons.Maximize2 size={14} />}
          onClick={() => void fitView({ maxZoom: 1, padding: 0.2 })}
        />
      </div>
      <span className="fc-zoom__level" aria-hidden="true">
        {Math.round(zoom * 100)} %
      </span>
    </div>
  );
}

type Props = {
  graph: FlowGraph;
  look: (n: FlowNode) => StepLook;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** The editor moves and joins steps; the detail only selects them. */
  edit?: {
    move: (id: string, x: number, y: number) => void;
    /** `when`: which way out of a check the connection leaves by. */
    connect: (source: string, target: string, when?: string) => void;
  };
  minimap?: boolean;
  /** A picture of the whole drawing (a chat's card): it does not pan, zoom or select, and the page scrolls over it. */
  still?: boolean;
  /** Changing it fits the view again (another run, another flow). */
  fitKey: string;
  /** On a phone, the steps a fit keeps in view (steps just added); the first two otherwise. */
  fitSteps?: readonly string[];
  /**
   * Clicking a step, or a new request, pans it to the middle of what `cover` leaves visible; `card`: a card is open
   * over the canvas now, so fitting the view leaves its part out too.
   */
  focus?: { request: { id: string; seq: number } | null; cover: Cover; card: boolean; onClick: (id: string) => void };
  children?: ReactNode;
};

export function FlowCanvas({
  graph,
  look,
  selected,
  onSelect,
  edit,
  minimap,
  still,
  fitKey,
  fitSteps,
  focus,
  children,
}: Props) {
  const t = useT();
  const initial = useMemo<Node<StepData>[]>(
    () =>
      graph.nodes.map((n, i) => ({
        id: n.id,
        type: "step",
        position: graph.layout.find((p) => p.node === n.id) ?? { x: i * 280, y: 0 },
        data: {
          ...look(n),
          kind: n.kind,
          kindLabel: t(STEP[n.kind].label),
          trigger: isTrigger(n.kind),
          branches: n.kind === "condition" ? branchesOf(n, t) : undefined,
        },
        selected: n.id === selected,
        draggable: Boolean(edit),
        connectable: Boolean(edit),
      })),
    [graph, look, selected, edit, t],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const ran = (id: string) => {
    const s = look(graph.nodes.find((n) => n.id === id) as FlowNode).state;
    return s === "ran" || s === "failed" || s === "live";
  };
  const checks = new Map(graph.nodes.flatMap((n) => (n.kind === "condition" ? [[n.id, branchesOf(n, t)]] : [])));
  const edges: Edge[] = graph.edges.map((e) => {
    const ways = checks.get(e.source);
    const when = ways ? (e.when ?? "yes") : undefined;
    return {
      id: `${e.source}:${e.target}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      ...(when
        ? {
            sourceHandle: when,
            label: ways?.find((b) => b.id === when)?.label ?? when,
            labelBgPadding: [6, 2] as [number, number],
            labelBgBorderRadius: 6,
          }
        : {}),
      className: [
        "fc-edge",
        ran(e.source) && ran(e.target) ? "is-ran" : "",
        when === FLOW_OTHERWISE ? "is-no" : when ? "is-yes" : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
  const changeNodes = (changes: NodeChange<Node<StepData>>[]) => {
    onNodesChange(changes);
    for (const change of changes) if (change.type === "select" && change.selected) onSelect(change.id);
  };
  return (
    <section className={edit ? "fc is-edit" : still ? "fc is-still" : "fc"} aria-label={t("flow.canvas")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={changeNodes}
        onNodeClick={(_, n) => {
          onSelect(n.id);
          focus?.onClick(n.id);
        }}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, n) => edit?.move(n.id, Math.round(n.position.x), Math.round(n.position.y))}
        onConnect={(c: Connection) =>
          c.source &&
          c.target &&
          edit?.connect(c.source, c.target, checks.has(c.source) ? (c.sourceHandle ?? undefined) : undefined)
        }
        nodesDraggable={Boolean(edit)}
        nodesConnectable={Boolean(edit)}
        elementsSelectable={!still}
        panOnDrag={!still}
        zoomOnScroll={!still}
        zoomOnPinch={!still}
        zoomOnDoubleClick={!still}
        preventScrolling={!still}
        minZoom={0.2}
        maxZoom={1.6}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        edgesFocusable={false}
        nodesFocusable={!still}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          "node.a11yDescription.default": t("flow.ed.stepsHint"),
          "node.a11yDescription.keyboardDisabled": t("flow.ed.stepsHint"),
          "controls.zoomIn.ariaLabel": t("flow.zoomIn"),
          "controls.zoomOut.ariaLabel": t("flow.zoomOut"),
          "controls.fitView.ariaLabel": t("flow.fit"),
          "minimap.ariaLabel": t("flow.canvas"),
        }}
      >
        <FitOnce
          fitKey={fitKey}
          first={fitSteps?.length ? [...fitSteps] : graph.nodes.slice(0, 2).map((n) => n.id)}
          cover={focus?.card ? focus.cover : undefined}
          whole={still}
        />
        {focus && <Focus request={focus.request} cover={focus.cover} />}
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="fc-grid" />
        {minimap && (
          <MiniMap
            pannable
            zoomable
            className="fc-minimap"
            nodeBorderRadius={4}
            nodeClassName={(n) => `fc-mini fc-mini--${STEP[(n.data as StepData).kind].tone}`}
          />
        )}
        {!still && <Zoom />}
        {children}
      </ReactFlow>
    </section>
  );
}
