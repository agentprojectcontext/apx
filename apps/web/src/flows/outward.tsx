// Before a drawing runs, the owner sees where it sends as them, what it calls, the commands it runs and the databases
// it changes (DECISIONS.md#d-169, #d-170). Publishing passes back the list they saw; the core refuses a drawing that
// does any of it without that list.
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
              {s.owner
                ? t("flow.outward.sendYou", { channel: s.channel })
                : t("flow.outward.send", { to: s.to, channel: s.channel })}
            </span>
          </li>
        ))}
        {once(asking?.outward.calls ?? [], (c) => `${c.method}\u0000${c.host}\u0000${c.secrets.join()}`).map((c) => (
          <li key={c.node}>
            <Icons.Globe size={16} />
            <span>
              {c.secrets.length
                ? t("flow.outward.callWith", { method: c.method, host: c.host, secrets: c.secrets.join(", ") })
                : t("flow.outward.call", { method: c.method, host: c.host })}
            </span>
          </li>
        ))}
        {(asking?.outward.commands ?? []).map((c) => (
          <li key={c.node}>
            <Icons.Terminal size={16} />
            <span>
              {c.folder ? t("flow.outward.run", { folder: c.folder }) : t("flow.outward.runHere")}
              <code className="fe-outward__code">{c.command}</code>
            </span>
          </li>
        ))}
        {once(asking?.outward.writes ?? [], (w) => w.database).map((w) => (
          <li key={w.node}>
            <Icons.Database size={16} />
            <span>{t("flow.outward.write", { database: w.database })}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
