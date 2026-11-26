import type { Part } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { Button, Icons } from "@apx/ui";
import { useRef, useState } from "react";
import { client } from "../../data/client.ts";
import { usePrefs } from "../../data/prefs.ts";
import { useData } from "../../data/state.ts";
import { LOCALES, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

type NoticeData = Extract<Part, { type: "notice" }>;

export function ContinuationNotice({ part }: { part: NoticeData }) {
  const t = useT();
  const locale = LOCALES[usePrefs((p) => p.language)];
  const online = useData((s) => s.connection === "online");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState(false);
  const [observed, setObserved] = useState<string>();
  const v = part.vars ?? {};
  const state = String(v.state === "pending" ? (observed ?? "pending") : (v.state ?? "pending"));
  const id = String(v.id ?? "");
  const thread = String(v.thread ?? "");
  const purpose = String(v.purpose ?? "");
  const date = (value: string | number | undefined) => {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? String(value ?? "")
      : new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(parsed);
  };
  const cancel = async () => {
    if (busy.current || !online) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      await client.call("continuations.cancel", { thread, id });
    } catch (err) {
      if (
        err instanceof ApxError &&
        err.code === "conflict" &&
        err.detail &&
        typeof err.detail === "object" &&
        "state" in err.detail &&
        typeof err.detail.state === "string"
      )
        setObserved(err.detail.state);
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const title =
    state === "pending"
      ? v.condition === "time"
        ? t("notice.continuation.scheduled")
        : t("notice.continuation.waiting")
      : state === "admitted"
        ? t("notice.continuation.started")
        : state === "completed"
          ? t("notice.continuation.completed")
          : state === "canceled"
            ? t("notice.continuation.canceled")
            : state === "expired"
              ? t("notice.continuation.expired")
              : state === "blocked"
                ? t("notice.continuation.blocked")
                : t("notice.continuation.failed");
  return (
    <div className="noticeline continuation-notice" role="status">
      <Icons.Clock size={14} />
      <div className="noticeline__text">
        <strong>{title}</strong>
        <p>{purpose}</p>
        {state === "pending" && (
          <>
            <p>
              {v.condition === "time"
                ? t("notice.continuation.at", { when: date(v.when) })
                : t("notice.continuation.whenTask", { when: String(v.when ?? "") })}
            </p>
            <p>{t("notice.continuation.until", { when: date(v.expires) })}</p>
          </>
        )}
        {state === "expired" && <p>{t("notice.continuation.expiredDetail")}</p>}
        {state === "blocked" && (
          <p>
            {v.reason === "task"
              ? t("notice.continuation.taskDetail")
              : v.reason === "unavailable"
                ? t("notice.continuation.unavailableDetail")
                : t("notice.continuation.blockedDetail")}
          </p>
        )}
        {state === "failed" && <p>{t("notice.continuation.failedDetail")}</p>}
        {error && (
          <p role="alert">
            {state === "admitted" || state === "completed"
              ? t("notice.continuation.alreadyStarted")
              : t("notice.continuation.cancelError")}
          </p>
        )}
        <span className="noticeline__actions">
          {state === "pending" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || !online}
              aria-label={t("notice.continuation.cancelLabel", { purpose })}
              onClick={() => void cancel()}
            >
              {t("notice.continuation.cancel")}
            </Button>
          )}
          {v.target && (
            <Button size="sm" variant="ghost" onClick={() => go.message(thread, String(v.target))}>
              {t("notice.continuation.view")}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
