import type { Result } from "@apx/protocol";
import { Button, Field, Input, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { FlowHistory } from "./FlowHistory.tsx";

export function FlowDetail({ flow }: { flow: string }) {
  const t = useT();
  const [data, setData] = useState<{ rows: Result<"flows.rows">["rows"]; events: Result<"flows.events">["events"] }>();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = useCallback(
    (e: unknown) => setError(t("flow.failed", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  const load = useCallback(async () => {
    const [rows, events] = await Promise.all([
      client.call("flows.rows", { flow, limit: 50 }),
      client.call("flows.events", { flow, limit: 50 }),
    ]);
    return { rows: rows.rows, events: events.events };
  }, [flow]);
  useEffect(() => {
    let live = true;
    void load()
      .then((data) => {
        if (live) setData(data);
      })
      .catch((e: unknown) => {
        if (live) fail(e);
      });
    return () => {
      live = false;
    };
  }, [load, fail]);
  const operate = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setData(await load());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const write = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setError(t("flow.jsonInvalid"));
      return;
    }
    await operate(async () => {
      await client.call("flows.write", { flow, key, value: parsed });
      notify(t("flow.written"), "info");
    });
  };
  const openRun = async (run: string) => {
    await operate(async () => {
      const info = await client.call("runs.get", { run });
      go.thread(info.thread_id);
    });
  };
  return (
    <div className="flow-detail">
      <div className="flow-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void operate(async () => {})}>
          {t("common.refresh")}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <Skeleton width="100%" height={80} />}
      <section aria-label={t("flow.table")}>
        <h3>{t("flow.table")}</h3>
        <p>{t("flow.limit")}</p>
        {data?.rows.length === 0 && <p>{t("flow.noRows")}</p>}
        <div className="flow-table">
          <table>
            <thead>
              <tr>
                <th>{t("flow.key")}</th>
                <th>{t("flow.value")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <code>{row.key}</code>
                  </td>
                  <td>
                    <pre>{JSON.stringify(row.value, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flow-form">
          <Field label={t("flow.key")}>
            {(id) => <Input id={id} value={key} maxLength={128} onChange={(e) => setKey(e.target.value)} />}
          </Field>
          <Field label={t("flow.value")}>
            {(id) => <textarea id={id} value={value} rows={4} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <Button disabled={busy || !key.trim()} onClick={() => void write()}>
            {t("flow.write")}
          </Button>
        </div>
      </section>
      <FlowHistory flow={flow} events={data?.events} busy={busy} operate={operate} openRun={openRun} />
    </div>
  );
}
