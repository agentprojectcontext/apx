// Before a drawing runs, the owner sees where it sends as them and what it calls (DECISIONS.md#d-169). Publishing
// passes back the list they saw; the core refuses a drawing that sends or calls out without it.
import type { Result } from "@apx/protocol";
import { Button, ChannelIcon, Dialog, Icons } from "@apx/ui";
import { client } from "../data/client.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import { useT } from "../i18n/index.ts";
import type { FlowGraph } from "./steps.tsx";

type Outward = Result<"flows.outward">;
type Asking = { outward: Outward; answer: (ok: boolean) => void };
const store = createStore<{ asking: Asking | undefined }>({ asking: undefined });

/**
 * The keys to publish `draft` with: none asked when it neither sends nor calls, or when everything it does was already
 * in what runs; otherwise the owner is asked, and undefined means they said no.
 */
export async function approveOutward(
  flow: string,
  draft: FlowGraph,
  published: FlowGraph | null,
): Promise<string[] | undefined> {
  const now = await client.call("flows.outward", { flow, graph: draft });
  if (!now.keys.length) return [];
  const before = published ? (await client.call("flows.outward", { flow, graph: published })).keys : [];
  if (now.keys.every((k) => before.includes(k))) return now.keys;
  const ok = await new Promise<boolean>((answer) => store.set({ asking: { outward: now, answer } }));
  return ok ? now.keys : undefined;
}

const hostOf = (host: string) => host.replace(/:\d+$/, "");
/** Two steps to the same person, or two calls to the same host, are said once. */
const once = <T,>(items: T[], key: (x: T) => string) =>
  items.filter((x, i) => items.findIndex((y) => key(y) === key(x)) === i);

/** The question itself; mounted once on the Flows screen, above the editor. */
export function OutwardConfirm() {
  const t = useT();
  const asking = useSlice(store, (s) => s.asking);
  const answer = (ok: boolean) => {
    asking?.answer(ok);
    store.set({ asking: undefined });
  };
  return (
    <Dialog
      open={Boolean(asking)}
      onOpenChange={(open) => !open && answer(false)}
      title={t("flow.outward.title")}
      description={t("flow.outward.body")}
      footer={
        <>
          <Button variant="secondary" onClick={() => answer(false)}>
            {t("flow.outward.no")}
          </Button>
          <Button onClick={() => answer(true)}>{t("flow.outward.yes")}</Button>
        </>
      }
    >
      <ul className="fe-outward">
        {once(asking?.outward.sends ?? [], (s) => `${s.channel}\u0000${s.to}`).map((s) => (
          <li key={s.node}>
            {s.type ? <ChannelIcon channel={s.type} size={16} /> : <Icons.Send size={16} />}
            <span>
              {s.to === "you"
                ? t("flow.outward.sendYou", { channel: s.channel })
                : t("flow.outward.send", { to: s.to, channel: s.channel })}
            </span>
          </li>
        ))}
        {once(asking?.outward.calls ?? [], (c) => `${c.method}\u0000${hostOf(c.host)}`).map((c) => (
          <li key={c.node}>
            <Icons.Globe size={16} />
            <span>{t("flow.outward.call", { method: c.method, host: hostOf(c.host) })}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
