import type { Result } from "@apx/protocol";
import { Button } from "@apx/ui";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { flowRunStateKey } from "./flow-state.ts";

const states: Record<Result<"flows.events">["events"][number]["state"], MessageKey> = {
  ignored: "flow.ignored",
  written: "flow.writtenState",
  pending: "flow.pending",
  admitted: "flow.admitted",
  failed: "flow.failedState",
};

export function FlowHistory({
  flow,
  events,
  busy,
  operate,
  openRun,
}: {
  flow: string;
  events: Result<"flows.events">["events"] | undefined;
  busy: boolean;
  operate: (action: () => Promise<void>) => Promise<void>;
  openRun: (run: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <section aria-label={t("flow.history")}>
      <h3>{t("flow.history")}</h3>
      <p>{t("flow.retryHint")}</p>
      {events?.length === 0 && <p>{t("flow.noEvents")}</p>}
      <div className="flow-table">
        <table>
          <thead>
            <tr>
              <th>{t("flow.event")}</th>
              <th>{t("flow.state")}</th>
              <th>{t("flow.runState")}</th>
              <th>{t("flow.when")}</th>
              <th>{t("flow.error")}</th>
              <th>{t("flow.run")}</th>
            </tr>
          </thead>
          <tbody>
            {events?.map((event) => (
              <tr key={event.event_id}>
                <td>
                  <code>{event.event_id}</code>
                </td>
                <td>{t(states[event.state])}</td>
                <td>{event.run_state === null ? "—" : t(flowRunStateKey(event.run_state))}</td>
                <td>
                  <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                </td>
                <td>
                  {event.error ?? "—"}
                  {event.state === "failed" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void operate(async () => {
                          const result = await client.call("flows.retry", { flow, event: event.event_id });
                          notify(t(result.queued ? "flow.retried" : "flow.notQueued"), "info");
                        })
                      }
                    >
                      {t("common.retry")}
                    </Button>
                  )}
                </td>
                <td>
                  {event.run_id ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void openRun(event.run_id as string)}
                    >
                      {t("flow.run")} <code>{event.run_id}</code>
                    </Button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
