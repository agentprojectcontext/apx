import { useId, useState } from "react";
import type { FlowBinding, FlowGraph, FlowGraphIssue, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { connectionError, connectNodes, moveNode, type NodeKind, newNode, removeNode } from "./graph-edit.ts";
import "./flow-graph.css";

// All visible copy is supplied by the host, including node names and validation codes.
export type FlowGraphText = (key: string) => string;
type Props = {
  graph: FlowGraph;
  onChange: (graph: FlowGraph) => void;
  issues: FlowGraphIssue[] | null;
  text: FlowGraphText;
  onValidate: () => void;
  onSaveDraft: () => void;
  busy?: boolean;
};
const kinds: NodeKind[] = ["webhook", "condition", "table_read", "table_write", "llm", "agent", "routine"];

function BindingEditor({
  value,
  nodes,
  onChange,
  t,
  literalOnly = false,
  legend,
}: {
  value: FlowBinding;
  nodes: FlowNode[];
  onChange: (v: FlowBinding) => void;
  t: FlowGraphText;
  literalOnly?: boolean;
  legend?: string;
}) {
  const id = useId();
  const literal = value.kind === "literal" ? value.value : "";
  return (
    <fieldset className="fg-fieldset">
      <legend>{legend ?? t("binding")}</legend>
      {!literalOnly && (
        <>
          <label htmlFor={`${id}-kind`}>{t("bindingSource")}</label>
          <select
            id={`${id}-kind`}
            value={value.kind}
            onChange={(e) => {
              const kind = e.target.value;
              onChange(
                kind === "literal"
                  ? { kind, value: "" }
                  : kind === "node"
                    ? { kind, node: nodes[0]?.id ?? "", path: [] }
                    : { kind: "event", path: [] },
              );
            }}
          >
            <option value="event">{t("eventData")}</option>
            <option value="node">{t("nodeOutput")}</option>
            <option value="literal">{t("literal")}</option>
          </select>
        </>
      )}
      {value.kind === "node" && (
        <>
          <label htmlFor={`${id}-node`}>{t("sourceNode")}</label>
          <select id={`${id}-node`} value={value.node} onChange={(e) => onChange({ ...value, node: e.target.value })}>
            <option value="">{t("chooseNode")}</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} ({n.id})
              </option>
            ))}
          </select>
        </>
      )}
      {value.kind !== "literal" ? (
        <>
          <span>{t("fieldPath")}</span>
          <small>{t("fieldPathHelp")}</small>
          {Object.keys(value.path).map((key) => {
            const index = Number(key);
            const segment = value.path[index] ?? "";
            return (
              <div className="fg-segment" key={key}>
                <label htmlFor={`${id}-path-${index}`}>
                  {t("pathSegment")} {index + 1}
                </label>
                <input
                  id={`${id}-path-${index}`}
                  value={segment}
                  onChange={(e) =>
                    onChange({ ...value, path: value.path.map((part, i) => (i === index ? e.target.value : part)) })
                  }
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...value, path: value.path.filter((_, i) => i !== index) })}
                  aria-label={`${t("removeSegment")} ${index + 1}`}
                >
                  {t("remove")}
                </button>
              </div>
            );
          })}
          <button
            type="button"
            disabled={value.path.length >= 16}
            onClick={() => onChange({ ...value, path: [...value.path, ""] })}
          >
            {t("addSegment")}
          </button>
        </>
      ) : (
        <>
          <label htmlFor={`${id}-type`}>{t("literalType")}</label>
          <select
            id={`${id}-type`}
            value={literal === null ? "null" : typeof literal}
            onChange={(e) =>
              onChange({
                kind: "literal",
                value:
                  e.target.value === "null"
                    ? null
                    : e.target.value === "boolean"
                      ? false
                      : e.target.value === "number"
                        ? 0
                        : "",
              })
            }
          >
            <option value="string">{t("text")}</option>
            <option value="number">{t("number")}</option>
            <option value="boolean">{t("boolean")}</option>
            <option value="null">{t("null")}</option>
          </select>
          {typeof literal === "boolean" ? (
            <label>
              <input
                type="checkbox"
                checked={literal}
                onChange={(e) => onChange({ kind: "literal", value: e.target.checked })}
              />
              {t("true")}
            </label>
          ) : (
            literal !== null && (
              <>
                <label htmlFor={`${id}-literal`}>{t("value")}</label>
                <input
                  id={`${id}-literal`}
                  type={typeof literal === "number" ? "number" : "text"}
                  value={literal}
                  onChange={(e) =>
                    onChange({
                      kind: "literal",
                      value: typeof literal === "number" ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              </>
            )
          )}
        </>
      )}
    </fieldset>
  );
}

function Inspector({
  node,
  nodes,
  update,
  t,
}: {
  node: FlowNode;
  nodes: FlowNode[];
  update: (n: FlowNode) => void;
  t: FlowGraphText;
}) {
  const id = useId();
  const field = (key: string, value: string, change: (v: string) => void, multiline = false) => (
    <label className="fg-field" htmlFor={`${id}-${key}`}>
      <span>{t(key)}</span>
      {multiline ? (
        <textarea id={`${id}-${key}`} value={value} onChange={(e) => change(e.target.value)} />
      ) : (
        <input id={`${id}-${key}`} value={value} onChange={(e) => change(e.target.value)} />
      )}
    </label>
  );
  return (
    <>
      {field("label", node.label, (label) => update({ ...node, label }))}
      {node.kind === "table_read" &&
        field("tableKeys", node.keys.join("\n"), (v) => update({ ...node, keys: v.split("\n") }), true)}
      {node.kind === "table_write" && field("tableKey", node.key, (key) => update({ ...node, key }))}
      {node.kind === "llm" && (
        <>
          {field("model", node.model, (model) => update({ ...node, model }))}
          <label className="fg-field">
            {t("maxOutputTokens")}
            <input
              type="number"
              min="1"
              max="2048"
              value={node.maxOutputTokens}
              onChange={(e) => update({ ...node, maxOutputTokens: Number(e.target.value) })}
            />
          </label>
          <label className="fg-field">
            {t("timeoutMs")}
            <input
              type="number"
              min="1000"
              max="120000"
              value={node.timeoutMs}
              onChange={(e) => update({ ...node, timeoutMs: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      {node.kind === "agent" && field("agent", node.agent, (agent) => update({ ...node, agent }))}
      {node.kind === "routine" && field("routine", node.routine, (routine) => update({ ...node, routine }))}
      {(node.kind === "llm" || node.kind === "agent") &&
        field("prompt", node.prompt, (prompt) => update({ ...node, prompt }), true)}
      {(node.kind === "condition" || node.kind === "llm" || node.kind === "agent" || node.kind === "routine") && (
        <BindingEditor
          t={t}
          legend={node.kind === "condition" ? t("conditionInput") : undefined}
          nodes={nodes.filter((n) => n.id !== node.id)}
          value={node.input}
          onChange={(input) => update({ ...node, input })}
        />
      )}
      {node.kind === "condition" && (
        <BindingEditor
          literalOnly
          legend={t("comparisonValue")}
          t={t}
          nodes={nodes}
          value={{ kind: "literal", value: node.equals }}
          onChange={(v) => {
            if (v.kind === "literal") update({ ...node, equals: v.value });
          }}
        />
      )}
      {node.kind === "table_write" && (
        <BindingEditor
          t={t}
          nodes={nodes.filter((n) => n.id !== node.id)}
          value={node.value}
          onChange={(value) => update({ ...node, value })}
        />
      )}
    </>
  );
}

export function FlowGraphEditor({ graph, onChange, issues, text: t, onValidate, onSaveDraft, busy = false }: Props) {
  const [focus, setFocus] = useState<{ id: string; sequence: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [kind, setKind] = useState<NodeKind>("condition");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const node = graph.nodes.find((n) => n.id === selected);
  const positions = graph.nodes.map(
    (n, i) => graph.layout.find((p) => p.node === n.id) ?? { node: n.id, x: 40 + i * 240, y: 80 },
  );
  const point = (id: string) => positions.find((p) => p.node === id);
  const update = (next: FlowNode) =>
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === next.id ? next : n)) });
  const connect = (from: string, to: string) => {
    const error = connectionError(graph, from, to);
    if (error) {
      setFeedback(t(`connection.${error}`));
      return;
    }
    onChange(connectNodes(graph, from, to));
    setFeedback(t("connection.added"));
  };
  const select = (id: string) => {
    setSelected(id);
    setConfirmRemove(false);
  };
  const add = () => {
    let i = 1;
    while (graph.nodes.some((n) => n.id === `node-${i}`)) i++;
    const next = newNode(kind, `node-${i}`, t(`kind.${kind}`));
    onChange({
      ...graph,
      nodes: [...graph.nodes, next],
      layout: [...graph.layout, { node: next.id, x: 40 + graph.nodes.length * 240, y: 80 }],
    });
    setSelected(next.id);
    setFocus((previous) => ({ id: next.id, sequence: (previous?.sequence ?? 0) + 1 }));
  };
  return (
    <section className="fg-editor" aria-label={t("editor")}>
      <header className="fg-header">
        <div>
          <h2>{t("editor")}</h2>
          <p>{t("draftOnly")}</p>
        </div>
        <div className="fg-actions">
          <button type="button" onClick={onValidate} disabled={busy}>
            {t("validate")}
          </button>
          <button type="button" onClick={onSaveDraft} disabled={busy}>
            {t("saveDraft")}
          </button>
        </div>
      </header>
      <p role="status" className="fg-notice">
        {t("executionUnavailable")}
      </p>
      <div className="fg-workspace">
        <div className="fg-main">
          <div className="fg-toolbar">
            <label>
              {t("addBlock")}{" "}
              <select value={kind} onChange={(e) => setKind(e.target.value as NodeKind)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={add} disabled={graph.nodes.length >= 32}>
              {t("add")}
            </button>
          </div>
          <GraphCanvas
            graph={graph}
            selected={selected}
            focus={focus}
            text={t}
            select={select}
            connect={connect}
            move={(id, x, y) => onChange(moveNode(graph, id, x, y))}
          />
          <p role="status">{feedback}</p>
          <details className="fg-list">
            <summary>{t("accessibleList")}</summary>
            <ol>
              {graph.nodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    aria-pressed={n.id === selected}
                    onClick={() => {
                      select(n.id);
                      setFocus((previous) => ({ id: n.id, sequence: (previous?.sequence ?? 0) + 1 }));
                    }}
                  >
                    {n.label || n.id} — {t(`kind.${n.kind}`)}
                  </button>
                </li>
              ))}
            </ol>
          </details>
          <fieldset className="fg-connect">
            <legend>{t("connections")}</legend>
            <label>
              {t("from")}{" "}
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">{t("chooseNode")}</option>
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("to")}{" "}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t("chooseNode")}</option>
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.id})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!source || !target} onClick={() => connect(source, target)}>
              {t("connect")}
            </button>
            <ul>
              {graph.edges.map((edge, i) => (
                <li key={`${edge.source}-${edge.target}`}>
                  <span>
                    {graph.nodes.find((n) => n.id === edge.source)?.label ?? edge.source} →{" "}
                    {graph.nodes.find((n) => n.id === edge.target)?.label ?? edge.target}
                  </span>{" "}
                  <button
                    type="button"
                    onClick={() => onChange({ ...graph, edges: graph.edges.filter((_, index) => index !== i) })}
                    aria-label={`${t("removeConnection")}: ${edge.source} → ${edge.target}`}
                  >
                    {t("remove")}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          <section aria-live="polite">
            <h3>{t("validation")}</h3>
            {issues === null ? (
              <p>{t("notValidated")}</p>
            ) : issues.length ? (
              <ul>
                {issues.map((issue) => (
                  <li key={`${issue.code}-${issue.node ?? ""}-${issue.message}`}>
                    {t(`issue.${issue.code}`)}
                    {issue.node ? ` (${issue.node})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noIssuesReported")}</p>
            )}
          </section>
        </div>
        <aside className="fg-inspector" aria-label={t("inspector")}>
          <h3>{t("inspector")}</h3>
          {node ? (
            <>
              <p>
                {t(`kind.${node.kind}`)} · <code>{node.id}</code>
              </p>
              <Inspector key={node.id} node={node} nodes={graph.nodes} update={update} t={t} />
              <fieldset className="fg-move">
                <legend>{t("moveBlock")}</legend>
                {[
                  ["left", -40, 0],
                  ["right", 40, 0],
                  ["up", 0, -40],
                  ["down", 0, 40],
                ].map(([direction, dx, dy]) => (
                  <button
                    type="button"
                    key={direction}
                    onClick={() => {
                      const p = point(node.id);
                      if (p) onChange(moveNode(graph, node.id, p.x + Number(dx), p.y + Number(dy)));
                    }}
                  >
                    {t(String(direction))}
                  </button>
                ))}
              </fieldset>
              {!confirmRemove ? (
                <button type="button" onClick={() => setConfirmRemove(true)}>
                  {t("removeBlock")}
                </button>
              ) : (
                <fieldset>
                  <legend>{t("confirmRemoveTitle")}</legend>
                  <p>{t("confirmRemoveWarning")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(removeNode(graph, node.id));
                      setSelected(null);
                      setConfirmRemove(false);
                    }}
                  >
                    {t("confirmRemove")}
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)}>
                    {t("cancel")}
                  </button>
                </fieldset>
              )}
            </>
          ) : (
            <p>{t("selectBlock")}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
