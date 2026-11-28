// The super-agent's button in the middle of the bottom bar: a tap calls it when calls work; otherwise holding it records
// a voice note for it, letting go sends the note and sliding away drops it.
import { useRef, useState } from "react";
import { type GestureResponderEvent, Text, View } from "react-native";
import { useAttachments } from "../chat/useAttachments";
import { useVoiceNote } from "../chat/useVoiceNote";
import { isWorking } from "../hooks/chatSelectors";
import type { Agent, Thread } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";
import { flash } from "../ui/Flash";
import { Icon } from "../ui/Icon";
import { makeStyles, useTheme } from "../ui/theme";
import type { CenterMode } from "./center";

const SIZE = 58;
/** A finger this far from where it pressed drops the note. */
const CANCEL_DISTANCE = 80;
/** Shorter than this is a tap, not a note: it says to hold instead. */
const TAP_MS = 350;

type Recording = "off" | "starting" | "on" | "cancelling" | "sending";

export function RobyButton({
  agent,
  mode,
  client,
  target,
  make,
  call,
}: {
  agent: Agent;
  mode: CenterMode;
  client: ApxClient;
  /** The chat a note goes to now; undefined: a new one is made with it. */
  target: () => Thread | undefined;
  make: () => Promise<Thread>;
  call: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [recording, setShown] = useState<Recording>("off");
  // The touch handlers read the state as it is now, not as it was at the last render.
  const now = useRef<Recording>("off");
  const setRecording = (next: Recording) => {
    now.current = next;
    setShown(next);
  };
  // Picked when the press starts, so the note's audio is uploaded to that chat.
  const going = useRef<Thread | undefined>(undefined);
  const [goingTo, setGoingTo] = useState<string>();
  const files = useAttachments(client, goingTo);
  const voice = useVoiceNote({ client, threadId: goingTo, upload: files.upload });
  const pressed = useRef({ x: 0, y: 0, at: 0, released: false });
  const label = mode === "call" ? t("voiceCall", { name: agent.name }) : t("robyHold", { name: agent.name });

  const send = async () => {
    setRecording("sending");
    try {
      const note = await voice.stop();
      if (!note) return;
      const thread = going.current ?? (await make());
      await client.call("threads.send", {
        thread: thread.id,
        text: note.words ?? t("voiceNote"),
        attachments: [note.audio],
        mode: isWorking(thread.state) ? "steer" : "queue",
      });
      flash(t("robySent", { name: agent.name }), "Send");
    } catch {
      flash(t("robyNotSent"), "TriangleAlert");
    } finally {
      setRecording("off");
    }
  };
  const press = (event: GestureResponderEvent) => {
    // A note still being sent takes no new one.
    if (now.current !== "off") return;
    const { pageX, pageY } = event.nativeEvent;
    pressed.current = { x: pageX, y: pageY, at: Date.now(), released: false };
    if (mode === "call") return;
    going.current = target();
    setGoingTo(going.current?.id);
    setRecording("starting");
    void voice.start().then((started) => {
      if (!started) return setRecording("off");
      // Let go before the microphone was ready: what it took is dropped like a tap.
      if (pressed.current.released) {
        void voice.cancel();
        setRecording("off");
        return;
      }
      setRecording("on");
    });
  };
  const move = (event: GestureResponderEvent) => {
    if (mode === "call" || (now.current !== "on" && now.current !== "cancelling")) return;
    const { pageX, pageY } = event.nativeEvent;
    const far = Math.hypot(pageX - pressed.current.x, pageY - pressed.current.y) > CANCEL_DISTANCE;
    setRecording(far ? "cancelling" : "on");
  };
  const release = () => {
    if (now.current === "sending") return;
    pressed.current.released = true;
    if (mode === "call") return call();
    const tap = Date.now() - pressed.current.at < TAP_MS;
    const was = now.current;
    if (was === "on" && !tap) return void send();
    if (was === "on" || was === "cancelling") void voice.cancel();
    if (was !== "starting") setRecording("off");
    if (tap) flash(t("robyHold", { name: agent.name }), "Mic");
  };
  const live = recording === "on" || recording === "cancelling";
  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;
  return (
    <View pointerEvents="box-none" style={s.root}>
      {live || recording === "sending" ? (
        <View pointerEvents="none" style={[s.hint, recording === "cancelling" && s.hintCancel]}>
          <Icon
            name={recording === "cancelling" ? "X" : recording === "sending" ? "Send" : "Mic"}
            size={14}
            color={recording === "cancelling" ? theme.danger : theme.fg}
          />
          <Text style={s.hintText}>
            {recording === "sending"
              ? t("robySending")
              : recording === "cancelling"
                ? t("robyReleaseCancel")
                : `${clock} · ${t("robySlideCancel")}`}
          </Text>
        </View>
      ) : null}
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        onAccessibilityTap={mode === "call" ? call : undefined}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={press}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={release}
        style={[s.button, live && s.buttonLive, recording === "cancelling" && s.buttonCancel]}
      >
        <Icon name={mode === "call" ? "Phone" : "Mic"} size={24} color={theme.accentFg} />
      </View>
      <Text numberOfLines={1} style={s.name}>
        {agent.name}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { alignItems: "center" },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.brand,
    borderWidth: 4,
    borderColor: theme.sidebar,
  },
  buttonLive: { transform: [{ scale: 1.12 }] },
  buttonCancel: { backgroundColor: theme.danger },
  name: { marginTop: 13, maxWidth: 88, color: theme.fg, fontSize: 12, fontWeight: "600" },
  hint: {
    position: "absolute",
    bottom: SIZE + 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.border,
  },
  hintCancel: { borderColor: theme.danger },
  hintText: { color: theme.fg, fontSize: 13, fontWeight: "500" },
}));
