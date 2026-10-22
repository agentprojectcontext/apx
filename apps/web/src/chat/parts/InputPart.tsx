import "../../styles/screens.css";
import type { ApprovalScope, FileChange, Part } from "@apx/protocol";
import { ActionGroup, Button, Icons, MarkdownView } from "@apx/ui";
import { Fragment, useState } from "react";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { respond } from "../../data/actions.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { DiffView } from "../../panel/DiffView.tsx";

const DONE: Record<Exclude<Extract<Part, { type: "input" }>["state"], "pending">, MessageKey> = {
  approved: "input.approved",
  denied: "input.denied",
  answered: "input.answered",
  expired: "input.expired",
  withdrawn: "input.withdrawn",
};

type InputPartData = Extract<Part, { type: "input" }>;

const DONE_ICON = {
  approved: Icons.Check,
  answered: Icons.Check,
  denied: Icons.X,
  expired: Icons.Clock,
  withdrawn: Icons.RotateCcw,
} as const;

/** An agent waiting for the owner: approve or decline an action, or answer a question. Once settled, one line. */
export function InputPart({ part }: { part: InputPartData }) {
  const { state } = part;
  if (state !== "pending") return <SettledInput part={part} state={state} />;
  return <PendingInput part={part} />;
}

/** What was asked and how it ended, in the actions' design: a line that opens to show what it was. */
function SettledInput({ part, state }: { part: InputPartData; state: Exclude<InputPartData["state"], "pending"> }) {
  const t = useT();
  const Icon = DONE_ICON[state];
  const what = part.folders
    ? t("input.askedFolder")
    : part.kind === "confirm"
      ? t("input.asked", { tool: part.tool ?? t("input.anAction") })
      : t("input.askedQuestion");
  return (
    <ActionGroup
      className={`turn__tools inputline is-${state}`}
      icon={part.kind === "confirm" ? <Icons.Hand size={14} /> : <Icons.MessageCircle size={14} />}
      title={
        <>
          {what}
          <span className={`inputline__state is-${state}`}>
            <Icon size={12} />
            {t(DONE[state])}
            {part.approval_scope === "session" && ` · ${t("input.sessionScope")}`}
            {part.approval_scope === "always" && ` · ${t("input.agentScope")}`}
            {part.approval_scope === "project" && ` · ${t("input.projectScope")}`}
            {part.answer && part.kind === "question" ? `: “${part.answer}”` : ""}
          </span>
        </>
      }
    >
      <div className="inputline__body">
        <Prompt part={part} />
        <Detail part={part} />
        {part.answer && part.kind === "confirm" && <p className="inputcard__answer">“{part.answer}”</p>}
      </div>
    </ActionGroup>
  );
}

/** What the agent asks, as Markdown; a folder card shows the folders it names as code, after the words before them. */
function Prompt({ part }: { part: InputPartData }) {
  const mdLabels = useMarkdownLabels();
  const folders = part.folders ?? [];
  const at = folders[0] ? part.prompt.indexOf(folders[0]) : -1;
  if (at < 0) return <MarkdownView source={part.prompt} size="sm" className="inputcard__prompt" labels={mdLabels} />;
  return (
    <p className="inputcard__prompt">
      {part.prompt.slice(0, at)}
      {folders.map((f, i) => (
        <Fragment key={f}>
          {i ? ", " : ""}
          <code className="inputcard__folder">{f}</code>
        </Fragment>
      ))}
    </p>
  );
}

/** What the call would do: the file's patch when the core could make one, else its arguments. */
function Detail({ part }: { part: InputPartData }) {
  if (part.change) return <ProposedChange change={part.change} />;
  return part.detail ? <code className="inputcard__detail">{part.detail}</code> : null;
}

function ProposedChange({ change }: { change: FileChange }) {
  const t = useT();
  return (
    <div className="inputcard__change">
      <div className="inputcard__file">
        <Icons.FileText size={14} />
        <span className="inputcard__path" title={change.path}>
          {change.path}
        </span>
        {change.status === "A" && <span className="wchanges__badge">{t("changes.new")}</span>}
        {change.added != null && <span className="wchanges__add">+{change.added}</span>}
        {change.removed != null && <span className="wchanges__del">−{change.removed}</span>}
      </div>
      <DiffView text={change.diff ?? ""} truncated={change.truncated ?? false} />
    </div>
  );
}

function PendingInput({ part }: { part: InputPartData }) {
  const t = useT();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const tick = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const send = async (a: { decision?: "approve" | "deny"; text?: string; scope?: ApprovalScope }) => {
    setBusy(true);
    await respond(part.input_id, a);
    setBusy(false);
  };
  return (
    <div className={`inputcard is-pending${part.change ? " has-change" : ""}`} role="alert">
      <div className="inputcard__head">
        {part.kind === "confirm" ? <Icons.Hand size={16} /> : <Icons.MessageCircle size={16} />}
        <span className="inputcard__title">
          {t(part.kind === "confirm" ? "input.confirmTitle" : "input.questionTitle")}
        </span>
      </div>
      <Prompt part={part} />
      <Detail part={part} />
      {part.approval_scopes && !part.folders && <p className="resd__note">{t("input.scopeHelp")}</p>}
      {part.kind === "confirm" && part.folders && (
        <div className="inputcard__actions">
          <Button size="sm" loading={busy} onClick={() => send({ decision: "approve" })}>
            {t("input.folderOnce")}
          </Button>
          {part.approval_scopes?.includes("project") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "project" })}
            >
              {t(part.folders.length > 1 ? "input.folderKeepMany" : "input.folderKeep")}
            </Button>
          )}
          {part.approval_scopes?.includes("always") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "always" })}
            >
              {t(part.folders.length > 1 ? "input.folderAlwaysMany" : "input.folderAlways")}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send({ decision: "deny" })}>
            {t("input.folderDeny")}
          </Button>
        </div>
      )}
      {part.kind === "confirm" && !part.folders && (
        <div className="inputcard__actions">
          <Button size="sm" loading={busy} onClick={() => send({ decision: "approve" })}>
            {t(part.approval_scopes ? "input.approveOnce" : "input.approve")}
          </Button>
          {part.approval_scopes?.includes("session") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "session" })}
            >
              {t("input.approveSession")}
            </Button>
          )}
          {part.approval_scopes?.includes("always") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "always" })}
            >
              {t("input.approveAlways")}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send({ decision: "deny" })}>
            {t("input.deny")}
          </Button>
        </div>
      )}
      {part.kind === "question" && (
        <form
          className="inputcard__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ text: text.trim() });
          }}
        >
          {part.options?.length ? (
            <div className="inputcard__options">
              {part.options.map((o) =>
                part.multi ? (
                  <Button
                    key={o}
                    size="sm"
                    variant={picked.includes(o) ? "primary" : "secondary"}
                    aria-pressed={picked.includes(o)}
                    disabled={busy}
                    onClick={() => tick(o)}
                  >
                    {picked.includes(o) ? <Icons.Check size={12} /> : null}
                    {o}
                  </Button>
                ) : (
                  <Button key={o} size="sm" variant="secondary" disabled={busy} onClick={() => send({ text: o })}>
                    {o}
                  </Button>
                ),
              )}
            </div>
          ) : null}
          <div className="inputcard__actions">
            {part.multi && part.options?.length ? (
              <Button
                size="sm"
                loading={busy}
                disabled={!picked.length}
                onClick={() => send({ text: part.options?.filter((o) => picked.includes(o)).join(", ") })}
              >
                {t("input.send")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => send({ text: t("input.skipped") })}>
              {t("input.skip")}
            </Button>
          </div>
          <input
            className="inputcard__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("input.answerPlaceholder")}
            aria-label={t("input.answerPlaceholder")}
            disabled={busy}
          />
        </form>
      )}
    </div>
  );
}
