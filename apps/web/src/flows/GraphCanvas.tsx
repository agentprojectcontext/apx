import {
  Background,
  type Connection,
  Controls,
  type Node,
  type NodeChange,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import type { FlowGraphText } from "./FlowGraphEditor.tsx";
import "@xyflow/react/dist/style.css";

type Props = {
  graph: FlowGraph;
  selected: string | null;
  text: FlowGraphText;
  select: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  connect: (source: string, target: string) => void;
  focus: { id: string; sequence: number } | null;
};

function FocusBlock({ focus }: { focus: Props["focus"] }) {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const focused = useRef<number | null>(null);
  useEffect(() => {
    if (ready && focus && focused.current !== focus.sequence) {
      focused.current = focus.sequence;
      void fitView({ nodes: [{ id: focus.id }], maxZoom: 1 });
    }
  }, [ready, focus, fitView]);
  return null;
}
export function GraphCanvas({ graph, selected, text, select, move, connect, focus }: Props) {
  const initial = useMemo<Node[]>(
    () =>
      graph.nodes.map((n, i) => ({
        id: n.id,
        position: graph.layout.find((p) => p.node === n.id) ?? { x: 40 + i * 240, y: 80 },
        data: { label: `${text(`kind.${n.kind}`)} · ${n.label || n.id}` },
        selected: n.id === selected,
        type: n.kind === "webhook" ? "input" : "default",
      })),
    [graph.nodes, graph.layout, selected, text],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges = graph.edges.map((e) => ({ id: `${e.source}:${e.target}`, source: e.source, target: e.target }));
  const changeNodes = (changes: NodeChange<Node>[]) => {
    onNodesChange(changes);
    for (const change of changes) {
      if (change.type === "select" && change.selected) select(change.id);
      if (change.type === "position" && change.position && change.dragging !== true) {
        move(change.id, change.position.x, change.position.y);
      }
    }
  };
  const onConnect = (c: Connection) => {
    if (c.source && c.target) connect(c.source, c.target);
  };
  return (
    <section className="fg-canvas" aria-label={text("canvasScroll")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={changeNodes}
        onNodeClick={(_, n) => select(n.id)}
        onNodeDragStop={(_, n) => move(n.id, n.position.x, n.position.y)}
        onConnect={onConnect}
        fitView
        minZoom={0.001}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        edgesFocusable={false}
        ariaLabelConfig={{
          "node.a11yDescription.default": text("nodeHint"),
          "node.a11yDescription.keyboardDisabled": text("nodeHint"),
          "node.a11yDescription.ariaLiveMessage": ({ x, y }) => `${text("moved")} ${x}, ${y}`,
          "edge.a11yDescription.default": text("edgeHint"),
          "controls.ariaLabel": text("canvasControls"),
          "controls.zoomIn.ariaLabel": text("zoomIn"),
          "controls.zoomOut.ariaLabel": text("zoomOut"),
          "controls.fitView.ariaLabel": text("fitView"),
          "controls.interactive.ariaLabel": text("canvasControls"),
          "minimap.ariaLabel": text("canvasScroll"),
          "handle.ariaLabel": text("handleHint"),
        }}
      >
        <FocusBlock focus={focus} />
        <Background />
        <Controls showInteractive={false} aria-label={text("canvasControls")} />
      </ReactFlow>
    </section>
  );
}
