// What the model received on a turn (runs.context): the size of each part, then the system prompt, the turn's input
// and the tools as they were sent.
import "./ReceivedDialog.css";
import type { PromptPart, RunContext } from "@apx/protocol";
import { Dialog, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";

const PART: Record<string, MessageKey> = {
  base: "received.part.base",
  profile: "received.part.profile",
  personality: "received.part.personality",
  instructions: "received.part.instructions",
  owner: "received.part.owner",
  agents_md: "received.part.agentsMd",
  org: "received.part.org",
  project_memory: "received.part.projectMemory",
  skills: "received.part.skills",
  message: "received.part.message",
};

const tokens = (chars: number) => Math.round(chars / 4);

/** Its strings come with it (a pack of their own): until they do, nothing shows. */
export function ReceivedDialog(props: { run: string; onClose: () => void }) {
  return usePack("received") ? <ReceivedBody {...props} /> : null;
}

function ReceivedBody({ run, onClose }: { run: string; onClose: () => void }) {
  const t = useT();
  const [got, setGot] = useState<RunContext | { error: string }>();
  useEffect(() => {
    let current = true;
    client.call("runs.context", { run }).then(
      (c) => current && setGot(c),
      (e: unknown) => current && setGot({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      current = false;
    };
  }, [run]);
  const size = (chars: number) =>
    t("received.size", { chars: chars.toLocaleString(), tokens: tokens(chars).toLocaleString() });
  // A block of the turn's input is named by its own tag ("[mode]"), shown as written.
  const name = (p: PromptPart) => (PART[p.name] ? t(PART[p.name] as MessageKey) : `[${p.name}]`);
  const rows = (label: string, total: number, parts: PromptPart[] = []) => (
    <>
      <tr>
        <td>{label}</td>
        <td>{size(total)}</td>
      </tr>
      {parts.length > 1 &&
        parts.map((p) => (
          <tr key={`${label}:${p.name}`} className="is-part">
            <td>{name(p)}</td>
            <td>{size(p.chars)}</td>
          </tr>
        ))}
    </>
  );
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={t("received.title")}
      description={t("received.description")}
      closeLabel={t("common.close")}
    >
      {!got ? (
        <Skeleton shape="block" height={160} />
      ) : "error" in got ? (
        <p>{got.error}</p>
      ) : (
        <>
          <table className="received__table">
            <tbody>
              {rows(t("received.system"), got.system.length, got.sizes.system)}
              {rows(t("received.input"), got.input.length, got.sizes.input)}
              {rows(t("received.tools", { n: got.tools.length }), got.sizes.tools)}
              {rows(t("received.history", { n: got.sizes.history.items }), got.sizes.history.chars)}
            </tbody>
          </table>
          <details className="received__text">
            <summary>{t("received.system")}</summary>
            <pre>{got.system}</pre>
          </details>
          <details className="received__text">
            <summary>{t("received.input")}</summary>
            <pre>{got.input}</pre>
          </details>
          <details className="received__text">
            <summary>{t("received.tools", { n: got.tools.length })}</summary>
            <pre>{got.tools.join(", ")}</pre>
          </details>
        </>
      )}
    </Dialog>
  );
}
