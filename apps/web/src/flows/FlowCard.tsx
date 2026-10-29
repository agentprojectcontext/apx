import type { Part, Result } from "@apx/protocol";
import { Badge, Button, Icons, Skeleton } from "@apx/ui";
import { useCallback, useContext, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useFlowDraft } from "../data/flowDrafts.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { stepDetail } from "./look.tsx";
import { OpenFlow } from "./openFlow.ts";
import type { FlowNode } from "./steps.tsx";
import "@apx/ui/flow.css";
import "./flow-card.css";

type Doc = Result<"flows.graph_get">;

/**
 * A Flow an agent made or changed in a chat: its drawing as a picture, whether it waits as a draft, and the way to its
 * editor. It reads the drawing again whenever it changes.
 */
export function FlowCard({ part }: { part: Extract<Part, { type: "flow" }> }) {
  const t = useT();
  // In the chat of the editor that shows this Flow, the canvas behind it is the picture.
  if (useContext(OpenFlow) === part.flow)
    return (
      <p className="flowcard-here">
        <Icons.GitBranch size={14} /> {t("flow.card.here")}
      </p>
    );
  return <FlowPicture part={part} />;
}

function FlowPicture({ part }: { part: Extract<Part, { type: "flow" }> }) {
  const ready = usePack("flow");
  const t = useT();
  const changed = useFlowDraft(part.flow);
  const project = useData((s) => s.projects.find((p) => p.id === part.project)?.name);
  const agents = useData((s) => s.agents);
  // null: the Flow is gone (retired) or out of reach.
  const [doc, setDoc] = useState<Doc | null>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed drawing is read again
  useEffect(() => {
    let live = true;
    client.call("flows.graph_get", { flow: part.flow }).then(
      (d) => live && setDoc(d),
      () => live && setDoc(null),
    );
    return () => {
      live = false;
    };
  }, [part.flow, changed]);
  const look = useCallback(
    (n: FlowNode): StepLook => ({ title: n.label, ...stepDetail(n, part.flow, agents, [], t) }),
    [part.flow, agents, t],
  );
  if (!ready) return <Skeleton width="100%" height={220} />;
  if (doc === null)
    return (
      <div className="flowcard flowcard--gone">
        <Icons.GitBranch size={14} /> {t("flow.card.gone", { name: part.name })}
      </div>
    );
  const graph = doc?.draft ?? doc?.published;
  const draft = Boolean(doc?.draft);
  return (
    <section className="flowcard" aria-label={t("flow.card.label", { name: part.name })}>
      <header className="flowcard__head">
        <span className="flowcard__icon" aria-hidden="true">
          <Icons.GitBranch size={14} />
        </span>
        <span className="flowcard__text">
          <span className="flowcard__name">{part.name}</span>
          <span className="flowcard__project">{project ?? part.project}</span>
        </span>
        {doc && (
          <Badge tone={draft ? "warning" : "brand"} dot>
            {t(draft ? "flow.card.draft" : "flow.card.published")}
          </Badge>
        )}
      </header>
      <div className="flowcard__canvas">
        {graph ? (
          <FlowCanvas
            graph={graph}
            look={look}
            selected={null}
            onSelect={() => {}}
            still
            fitKey={`${part.flow}:${doc?.draftVersion ?? ""}:${doc?.publishedRevision ?? ""}`}
          />
        ) : (
          <Skeleton width="100%" height="100%" />
        )}
      </div>
      <footer className="flowcard__foot">
        {draft && (
          <span className="flowcard__hint">
            {t(doc?.publishedRevision === null ? "flow.card.newHint" : "flow.card.changedHint")}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Pencil size={14} />}
          onClick={() => go.flows(undefined, part.flow, true)}
        >
          {t("flow.card.open")}
        </Button>
      </footer>
    </section>
  );
}
