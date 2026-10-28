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
import { type FlowGraph, type FlowNode, isTrigger, STEP } from "./steps.tsx";
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
};
type StepData = StepLook & {
  kind: FlowNode["kind"];
  kindLabel: string;
  trigger: boolean;
  /** A check's two ways out, named for the person. */
  branches?: { yes: string; no: string } | undefined;
};

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
    >
      {!data.trigger && <Handle type="target" position={Position.Left} className="fc-handle fc-handle--in" />}
      {data.branches ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            className="fc-handle fc-handle--out fc-handle--yes"
            style={{ top: "32%" }}
            title={data.branches.yes}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            className="fc-handle fc-handle--out fc-handle--no"
            style={{ top: "68%" }}
            title={data.branches.no}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="fc-handle fc-handle--out" />
      )}
    </FlowStep>
  );
}
const nodeTypes = { step: StepNode };

/**
 * Fits the view once the steps have sizes, and again when `fitKey` changes. On a phone the whole chain would be
 * too small to read: it shows the first steps and the rest is a pan away.
 */
function FitOnce({ fitKey, first }: { fitKey: string; first: string[] }) {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const narrow = useStore((s) => s.width > 0 && s.width < 600);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (ready && done.current !== fitKey) {
      done.current = fitKey;
      void fitView({ maxZoom: 1, padding: 0.2, ...(narrow ? { nodes: first.map((id) => ({ id })) } : {}) });
    }
  }, [ready, fitKey, fitView, narrow, first]);
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
    connect: (source: string, target: string, when?: "yes" | "no") => void;
  };
  minimap?: boolean;
  /** Changing it fits the view again (another run, another flow). */
  fitKey: string;
  children?: ReactNode;
};

export function FlowCanvas({ graph, look, selected, onSelect, edit, minimap, fitKey, children }: Props) {
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
          branches: n.kind === "condition" ? { yes: t("flow.f.yes"), no: t("flow.f.no") } : undefined,
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
  const checks = new Set(graph.nodes.filter((n) => n.kind === "condition").map((n) => n.id));
  const edges: Edge[] = graph.edges.map((e) => {
    const when = checks.has(e.source) ? (e.when ?? "yes") : undefined;
    return {
      id: `${e.source}:${e.target}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      ...(when
        ? {
            sourceHandle: when,
            label: t(when === "no" ? "flow.f.no" : "flow.f.yes"),
            labelBgPadding: [6, 2] as [number, number],
            labelBgBorderRadius: 6,
          }
        : {}),
      className: [
        "fc-edge",
        ran(e.source) && ran(e.target) ? "is-ran" : "",
        when === "no" ? "is-no" : when ? "is-yes" : "",
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
    <section className={edit ? "fc is-edit" : "fc"} aria-label={t("flow.canvas")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={changeNodes}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, n) => edit?.move(n.id, Math.round(n.position.x), Math.round(n.position.y))}
        onConnect={(c: Connection) =>
          c.source &&
          c.target &&
          edit?.connect(c.source, c.target, checks.has(c.source) ? (c.sourceHandle === "no" ? "no" : "yes") : undefined)
        }
        nodesDraggable={Boolean(edit)}
        nodesConnectable={Boolean(edit)}
        minZoom={0.2}
        maxZoom={1.6}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        edgesFocusable={false}
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
        <FitOnce fitKey={fitKey} first={graph.nodes.slice(0, 2).map((n) => n.id)} />
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
        <Zoom />
        {children}
      </ReactFlow>
    </section>
  );
}
