import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import type { DelegationState } from "../../hooks/continueSession";
import { lang, t } from "../../i18n";
import { type Message, noticeText } from "../../protocol";
import { Icon } from "../Icon";
import { Button } from "../kit";
import { makeStyles, useTheme } from "../theme";

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
}: {
  part: NoticePart;
  goOn?: GoOn | undefined;
  continueSession?: ContinueSession | undefined;
  sessionState?: SessionState | undefined;
}) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.notice}>
      <Icon
        name={part.level === "info" ? "Info" : "TriangleAlert"}
        size={16}
        color={part.level === "error" ? theme.danger : part.level === "warn" ? theme.warning : theme.fgMuted}
      />
      <Text
        style={[
          s.text,
          part.level === "error" && { color: theme.danger },
          part.level === "info" && { color: theme.fgMuted },
        ]}
      >
        {noticeText(part, lang)}
      </Text>
      {part.detail ? (
        <Text numberOfLines={part.level === "error" ? 8 : 2} style={s.code}>
          {part.detail}
        </Text>
      ) : null}
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
  text: { color: theme.warning, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%" },
  done: { color: theme.fgMuted, fontSize: 12, width: "100%" },
  code: { color: theme.fgMuted, fontSize: 12, fontFamily: theme.mono },
}));
