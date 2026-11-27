import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Text, type View } from "react-native";
import { lang, t } from "../../i18n";
import { type ApxClient, ApxError, type Message, noticeText } from "../../protocol";
import { Button } from "../kit";
import { makeStyles } from "../theme";
import { CompactRow } from "./CompactRow";

type Notice = Extract<Message["parts"][number], { type: "notice" }>;
const words = (key: string, vars?: Record<string, string | number>) =>
  noticeText({ code: `continuation.${key}`, text: key, ...(vars ? { vars } : {}) }, lang);

/** The receipt changes only after the core confirms cancellation; blocked checks never offer it. */
export function ContinuationNotice({ part, client }: { part: Notice; client?: ApxClient | undefined }) {
  const s = useStyles();
  const [observed, setObserved] = useState<string>();
  const heading = useRef<View>(null);
  useEffect(() => {
    if (!observed) return;
    // The cancel control disappears after confirmation; keep its result in reach of the screen reader.
    const node = findNodeHandle(heading.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [observed]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState(false);
  const v = part.vars ?? {};
  const state = String(v.state === "pending" ? (observed ?? "pending") : (v.state ?? "pending"));
  const title = words(
    state === "pending" ? (v.condition === "time" ? "scheduled" : "waiting") : state === "admitted" ? "started" : state,
  );
  const purpose = String(v.purpose ?? "");
  const date = (value: string | number | undefined) => {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? { date: String(value ?? ""), time: "" }
      : {
          date: parsed.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }),
          time: parsed.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
        };
  };
  const cancel = async () => {
    if (!client || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      const saved = await client.call("continuations.cancel", { thread: String(v.thread), id: String(v.id) });
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
      setBusy(false);
      lock.current = false;
    }
  };
  const warning = state === "blocked" || state === "failed" || state === "expired";
  return (
    <CompactRow
      headingRef={heading}
      title={`${t("followup")} · ${title}`}
      icon={warning ? "TriangleAlert" : state === "completed" ? "CircleCheck" : "Clock"}
      warning={warning}
      compact
      trailing={
        state === "pending" && client && v.id && v.thread ? (
          <Button
            size="sm"
            variant="ghost"
            label={words("cancel")}
            accessibilityLabel={words("cancelLabel", { purpose })}
            busy={busy}
            disabled={busy}
            onPress={() => void cancel()}
          />
        ) : null
      }
      feedback={
        error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {words(state === "admitted" || state === "completed" ? "alreadyStarted" : "cancelError")}
          </Text>
        ) : null
      }
    >
      <Text selectable style={s.text}>
        {purpose}
      </Text>
      {state === "pending" ? (
        <>
          <Text style={s.text}>
            {v.condition === "time" ? words("at", date(v.when)) : words("whenTask", { when: String(v.when ?? "") })}
          </Text>
          <Text style={s.text}>{words("until", date(v.expires))}</Text>
        </>
      ) : null}
      {state === "blocked" ? (
        <Text style={s.text}>
          {words(
            v.reason === "task"
              ? "taskDetail"
              : v.reason === "unavailable"
                ? "unavailableDetail"
                : v.reason === "access"
                  ? "accessDetail"
                  : "blockedDetail",
          )}
        </Text>
      ) : null}
      {state === "expired" ? (
        <Text style={s.text}>
          {v.condition === "task_done" && v.reason !== "ready_expired"
            ? v.when
              ? words("expiredEvent", { when: String(v.when) })
              : words("expiredEventUnknown")
            : words("expiredDetail")}
        </Text>
      ) : null}
      {state === "failed" ? <Text style={s.text}>{words("failedDetail")}</Text> : null}
      {part.detail ? (
        <Text selectable style={s.text}>
          {part.detail}
        </Text>
      ) : null}
    </CompactRow>
  );
}

const useStyles = makeStyles((theme) => ({
  text: { fontSize: 13, lineHeight: 19, color: theme.fgMuted },
  error: { fontSize: 13, color: theme.danger },
}));
