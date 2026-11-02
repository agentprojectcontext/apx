import type { StorageBackup, StorageComputer } from "@apx/protocol";
import { Button, Dialog, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { dayLabel, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { size } from "../data/usageModel.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

const MB = 1048576;
const human = (bytes: number) => (bytes > 0 && bytes < MB ? "< 1 MB" : size(bytes / MB));
/** Reads of the list while the computer turns off (a second apart). */
const STOP_READS = 45;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Pending = { title: string; body: string; done: MessageKey; run: () => Promise<{ freed_bytes: number }> };

/** Asks before a delete, saying what is lost; the list reads again after it. */
function useDelete(reload: () => Promise<void>, onFreed: () => void) {
  const t = useT();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const r = await pending.run();
      notify(t(pending.done, { size: human(r.freed_bytes) }), "info");
      setPending(undefined);
      onFreed();
      await reload();
    } catch (e) {
      notify(t("storage.deleteFailed", { error: message(e) }));
    } finally {
      setBusy(false);
    }
  };
  const dialog = pending && (
    <Dialog
      open
      title={pending.title}
      description={pending.body}
      onOpenChange={(open) => !open && !busy && setPending(undefined)}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => setPending(undefined)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {t("storage.delete")}
          </Button>
        </>
      }
    />
  );
  return { ask: setPending, dialog };
}

function useList<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      setItems(await load());
      setError(undefined);
    } catch (e) {
      setError(message(e));
    }
  }, [load]);
  useEffect(() => void reload(), [reload]);
  return { items, error, reload };
}

const loadComputers = async () => (await client.call("storage.computers.list", {})).computers;
const loadBackups = async () => (await client.call("storage.backups.list", {})).backups;

/** Each of the agents' computers: its size, whether it is on, and a delete once it is off. */
export function ComputerItems({ onFreed }: { onFreed: () => void }) {
  const t = useT();
  const { items, error, reload } = useList(loadComputers);
  const { ask, dialog } = useDelete(reload, onFreed);
  const [stopping, setStopping] = useState(false);
  const name = (c: StorageComputer) =>
    c.kind === "agents" ? t("storage.computers.agents") : t("storage.computers.lab", { name: c.name });
  /** Turned off for every agent; it takes a few seconds, so the list is read until it says so. */
  const turnOff = async () => {
    setStopping(true);
    try {
      await client.call("environments.stop", {});
      for (let i = 0; i < STOP_READS; i++) {
        const now = await loadComputers();
        if (!now.some((c) => c.kind === "agents" && c.on)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      await reload();
    } catch (e) {
      notify(t("storage.computers.turnOffFailed", { error: message(e) }));
    } finally {
      setStopping(false);
    }
  };
  if (error && !items) return <p className="usage__error">{t("storage.unavailable", { error })}</p>;
  if (!items) return <Skeleton height={48} shape="block" />;
  if (!items.length) return <p className="usage__note">{t("storage.computers.empty")}</p>;
  return (
    <>
      <ul className="storage-items" data-testid="storage-computers">
        {items.map((c) => (
          <li key={c.id} className="storage-items__row">
            <div className="storage-items__text">
              <span className="storage-items__name">{name(c)}</span>
              <span className="storage-items__meta">
                <span className={c.on ? "usage__state is-on" : "usage__state"}>
                  {t(c.on ? "storage.computers.on" : "storage.computers.off")}
                </span>
                {human(c.bytes)}
                {c.last_used_at && ` · ${t("storage.computers.lastUse", { when: shortWhen(c.last_used_at) })}`}
              </span>
              {c.on && <span className="usage__note">{t("storage.computers.offFirst")}</span>}
            </div>
            {c.on ? (
              c.can_turn_off && (
                <Button size="sm" variant="secondary" loading={stopping} onClick={() => void turnOff()}>
                  {t("storage.computers.turnOff")}
                </Button>
              )
            ) : (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${t("storage.delete")}: ${name(c)}`}
                onClick={() =>
                  ask({
                    title:
                      c.kind === "agents"
                        ? t("storage.computers.confirmAgentsTitle")
                        : t("storage.computers.confirmLabTitle", { name: c.name }),
                    body: t(c.kind === "agents" ? "storage.computers.confirmAgents" : "storage.computers.confirmLab", {
                      size: human(c.bytes),
                    }),
                    done: "storage.computers.deleted",
                    run: () => client.call("storage.computers.delete", { id: c.id }),
                  })
                }
              >
                {t("storage.delete")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}

/** Each backup copy of the database, with its date and size, and a delete. */
export function BackupItems({ onFreed }: { onFreed: () => void }) {
  const t = useT();
  const { items, error, reload } = useList(loadBackups);
  const { ask, dialog } = useDelete(reload, onFreed);
  if (error && !items) return <p className="usage__error">{t("storage.unavailable", { error })}</p>;
  if (!items) return <Skeleton height={48} shape="block" />;
  if (!items.length) return <p className="usage__note">{t("storage.backups.empty")}</p>;
  return (
    <>
      <ul className="storage-items" data-testid="storage-backups">
        {items.map((b: StorageBackup) => (
          <li key={b.id} className="storage-items__row">
            <div className="storage-items__text">
              <span className="storage-items__name">{dayLabel(b.created_at)}</span>
              <span className="storage-items__meta">
                {human(b.bytes)} · {b.name}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${t("storage.delete")}: ${dayLabel(b.created_at)}`}
              onClick={() =>
                ask({
                  title: t("storage.backups.confirmTitle", { date: dayLabel(b.created_at) }),
                  body: t("storage.backups.confirmBody", { size: human(b.bytes) }),
                  done: "storage.backups.deleted",
                  run: () => client.call("storage.backups.delete", { id: b.id }),
                })
              }
            >
              {t("storage.delete")}
            </Button>
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}
