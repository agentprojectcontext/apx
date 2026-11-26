import type { Part } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { Button, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../../data/client.ts";
import { usePrefs } from "../../data/prefs.ts";
import { useData } from "../../data/state.ts";
import { LOCALES, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

type NoticeData = Extract<Part, { type: "notice" }>;

function dateParts(value: string | number | undefined, locale: string) {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return { date: String(value ?? ""), time: "" };
  return {
    date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(parsed),
    time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(parsed),
  };
}

export function ContinuationNotice({ part }: { part: NoticeData }) {
  const t = useT();
  const locale = LOCALES[usePrefs((p) => p.language)];
  const online = useData((s) => s.connection === "online");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const localFocus = useRef(false);
  const status = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(false);
  const [observed, setObserved] = useState<string>();
  const v = part.vars ?? {};
  const state = String(v.state === "pending" ? (observed ?? "pending") : (v.state ?? "pending"));
  const id = String(v.id ?? "");
  const thread = String(v.thread ?? "");
  const purpose = String(v.purpose ?? "");
  useEffect(() => {
    if (!localFocus.current || pending) return;
    if (state !== "pending") status.current?.focus();
    else if (error) cancelButton.current?.focus();
    else return;
    localFocus.current = false;
  }, [state, pending, error]);
  const cancel = async () => {
    if (busy.current || !online) return;
    busy.current = true;
    localFocus.current = true;
    setPending(true);
    setError(false);
    try {
      const saved = await client.call("continuations.cancel", { thread, id });
      setObserved(saved.state);
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
        <strong ref={status} className="continuation-notice__status" tabIndex={-1}>
          {title}
        </strong>
        <p>{purpose}</p>
        {state === "pending" && (
          <>
            <p>
              {v.condition === "time"
                ? t("notice.continuation.at", dateParts(v.when, locale))
                : t("notice.continuation.whenTask", { when: String(v.when ?? "") })}
            </p>
            <p>{t("notice.continuation.until", dateParts(v.expires, locale))}</p>
          </>
        )}
        {state === "expired" && (
          <p>
            {v.condition === "task_done" && v.reason !== "ready_expired"
              ? v.when
                ? t("notice.continuation.expiredEvent", { when: String(v.when) })
                : t("notice.continuation.expiredEventUnknown")
              : t("notice.continuation.expiredDetail")}
          </p>
        )}
        {state === "blocked" && (
          <p>
            {v.reason === "task"
              ? t("notice.continuation.taskDetail")
              : v.reason === "unavailable"
                ? t("notice.continuation.unavailableDetail")
                : v.reason === "access"
                  ? t("notice.continuation.accessDetail")
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
      </div>
      <span className="noticeline__actions">
        {state === "pending" && (
          <Button
            ref={cancelButton}
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
  );
}
