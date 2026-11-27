import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import type { DelegationState } from "../../hooks/continueSession";
import { lang, t } from "../../i18n";
import { type ApxClient, isRestartNotice, type Message, noticeText } from "../../protocol";
import { Icon } from "../Icon";
import { Button } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { CompactRow } from "./CompactRow";
import { ContinuationNotice } from "./ContinuationNotice";

type NoticePart = Extract<Message["parts"][number], { type: "notice" }>;
/** Lets a conversation the breaker paused go on: a fresh budget, or no limit until the owner writes there again. */
export type GoOn = (thread: string, mode: "reset" | "release") => Promise<unknown>;
/** Lets a delegated session a limit stopped go on with one more turn, as Continue on the web does. */
export type ContinueSession = (session: string) => Promise<unknown>;
/** Reads where a delegated session stands now, so Continue shows only while it is stopped. */
export type SessionState = (session: string) => Promise<DelegationState>;

/** Something the system says about a turn (interrupted, paused, no answer), with the way on when there is one. */
export function NoticeCard({
  part,
  goOn,
  continueSession,
  sessionState,
  client,
  details,
}: {
  part: NoticePart;
  client?: ApxClient | undefined;
  details?: string[] | undefined;
  goOn?: GoOn | undefined;
  continueSession?: ContinueSession | undefined;
  sessionState?: SessionState | undefined;
}) {
  const theme = useTheme();
  const s = useStyles();
  if (part.code === "continuation.receipt") return <ContinuationNotice part={part} client={client} />;
  const actionable = Boolean(
    (goOn && part.code.startsWith("breaker.") && typeof part.vars?.thread === "string") ||
      (continueSession && part.code === "delegation.limit" && typeof part.vars?.subthread === "string"),
  );
  const text = noticeText(part, lang);
  const body = (
    <>
      {part.code !== "memory.saved" || !(details?.length || part.detail) ? (
        <Text selectable style={s.body}>
          {text}
        </Text>
      ) : null}
      {(details ?? (part.detail ? [part.detail] : [])).map((detail, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: repeated notes retain their order
        <Text key={i} selectable style={s.code}>
          {detail}
        </Text>
      ))}
    </>
  );
  if (part.level !== "error" && !actionable) {
    const memory = part.code === "memory.saved";
    const research = part.code === "research.updated";
    // A restart that cut a turn is a quiet line of the system's, not a warning.
    const restart = isRestartNotice(part);
    const brief = !details?.length && !part.detail?.trim() && text.length <= 160 && !text.includes("\n");
    const title =
      part.code === "thread.compacted"
        ? t("noticeContext")
        : memory || research || restart || brief
          ? text
          : t(part.level === "warn" ? "noticeWarning" : "noticeInfo");
    const hasDetail = part.code !== "thread.compacted" && Boolean(details?.length || part.detail || title !== text);
    return (
      <CompactRow
        title={title}
        compact
        icon={
          memory
            ? "Brain"
            : research
              ? "Search"
              : part.code === "thread.compacted"
                ? "Archive"
                : restart
                  ? "RotateCcw"
                  : part.level === "warn"
                  ? "TriangleAlert"
                  : "Info"
        }
        warning={part.level === "warn" && !restart}
      >
        {hasDetail ? body : undefined}
      </CompactRow>
    );
  }
  return (
    <View style={s.notice} accessibilityRole={part.level === "error" ? "alert" : undefined}>
      <Icon
        name={part.level === "info" ? "Info" : "TriangleAlert"}
        size={16}
        color={part.level === "error" ? theme.danger : theme.warning}
      />
      {body}
      {goOn && part.code.startsWith("breaker.") && typeof part.vars?.thread === "string" ? (
        <BreakerActions thread={part.vars.thread} goOn={goOn} />
      ) : null}
      {continueSession &&
      part.code === "delegation.limit" &&
      !String(part.vars?.variant).startsWith("continued") &&
      typeof part.vars?.subthread === "string" ? (
        <DelegationContinue
          session={part.vars.subthread}
          continueSession={continueSession}
          sessionState={sessionState}
        />
      ) : null}
    </View>
  );
}

/**
 * Continue on a delegated session a limit stopped: one more turn, judged again by the core when pressed. Read as the
 * session stands now, it shows only while the session is stopped, as on the web.
 */
function DelegationContinue({
  session,
  continueSession,
  sessionState,
}: {
  session: string;
  continueSession: ContinueSession;
  sessionState?: SessionState | undefined;
}) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [state, setState] = useState<DelegationState | "unknown">(sessionState ? "loading" : "unknown");
  useEffect(() => {
    if (!sessionState) return;
    let live = true;
    sessionState(session).then(
      (now) => live && setState(now),
      () => live && setState("unknown"),
    );
    return () => {
      live = false;
    };
  }, [session, sessionState]);
  if (done) return <Text style={s.done}>{t("delegationWentOn")}</Text>;
  if (state === "loading") return null;
  // The same words as the web's notice ("Still working", "Finished"), from the protocol's notice texts.
  if (state !== "stopped" && state !== "unknown")
    return (
      <Text style={s.done}>
        {noticeText({ code: "delegation.limit", text: state, vars: { variant: state } }, lang)}
      </Text>
    );
  const go = () => {
    setBusy(true);
    continueSession(session)
      .then(() => setDone(true))
      .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={s.actions}>
      <Button size="sm" label={t("delegationContinue")} busy={busy} disabled={busy} onPress={go} />
    </View>
  );
}

/** A paused chain's way on, as on the web: a fresh budget, or no limit this round (DECISIONS.md#d-081). */
function BreakerActions({ thread, goOn }: { thread: string; goOn: GoOn }) {
  const s = useStyles();
  const [busy, setBusy] = useState<"reset" | "release">();
  const [done, setDone] = useState(false);
  if (done) return <Text style={s.done}>{t("breakerWentOn")}</Text>;
  const go = (mode: "reset" | "release") => {
    setBusy(mode);
    goOn(thread, mode)
      .then(() => setDone(true))
      .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(undefined));
  };
  return (
    <View style={s.actions}>
      <Button
        size="sm"
        label={t("breakerReset")}
        busy={busy === "reset"}
        disabled={Boolean(busy)}
        onPress={() => go("reset")}
      />
      <Button
        size="sm"
        variant="secondary"
        label={t("breakerRelease")}
        busy={busy === "release"}
        disabled={Boolean(busy)}
        onPress={() => go("release")}
      />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.fill,
    maxWidth: "88%",
  },
  body: { color: theme.fg, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%" },
  done: { color: theme.fgMuted, fontSize: 12, width: "100%" },
  code: { color: theme.fgMuted, fontSize: 12, fontFamily: theme.mono },
}));
