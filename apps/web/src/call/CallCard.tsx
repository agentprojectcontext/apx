import "../styles/call.css";
import type { CallFrame, CallVoice } from "@apx/protocol";
import { Button, IconButton, Icons, SegmentedControl } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { calls, useCalls } from "../data/calls.ts";
import { client } from "../data/client.ts";
import { secretary } from "../data/identity.ts";
import { usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { type CallLine, openLine, openMic } from "./callLine.ts";
import { closeCall, loadCallStatus, savedVoice, saveVoice } from "./callStatus.ts";

type Stage = "setup" | "calling" | "preparing" | "live" | "ended";
type Talk = Extract<CallFrame, { type: "state" }>["state"];

const END_REASON: Record<string, MessageKey> = {
  engine: "callCard.end.engine",
  network: "callCard.end.network",
  max_duration: "callCard.end.max_duration",
};

/**
 * A call with the super-agent, floating over its chat: the voice to use before it starts, then who and how it is
 * going (listening, thinking, speaking), how long, what the owner is saying now, and mute, sound and hang up.
 */
export function CallCard() {
  const t = useT();
  const agent = useData((s) => secretary(s.agents));
  const name = agent?.name ?? "";
  const thread = useCalls((s) => s.card?.thread);
  const status = useCalls((s) => s.status);
  const lang = usePrefs((s) => s.language);
  const [voice, setVoice] = useState<CallVoice>(savedVoice);
  const [stage, setStage] = useState<Stage>("setup");
  const [talk, setTalk] = useState<Talk>("listening");
  const [partial, setPartial] = useState("");
  const [muted, setMuted] = useState(false);
  const [sound, setSound] = useState(true);
  const [since, setSince] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState<MessageKey>();
  const line = useRef<CallLine | undefined>(undefined);
  // The owner hung up (or closed the card) while the call was still being placed.
  const hungUp = useRef(false);
  // Mute and sound as chosen, also while the call is still being placed.
  const chosen = useRef({ muted: false, sound: true });

  useEffect(() => {
    if (since === undefined) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [since]);

  // Closing the card hangs up.
  useEffect(
    () => () => {
      hungUp.current = true;
      line.current?.hangUp();
    },
    [],
  );

  const finish = (reason?: MessageKey) => {
    line.current = undefined;
    calls.set({ live: undefined });
    void loadCallStatus();
    if (hungUp.current) {
      closeCall();
      return;
    }
    setProblem(reason);
    setPartial("");
    setStage("ended");
  };

  const onFrame = (f: CallFrame) => {
    if (f.type === "preparing") setStage("preparing");
    else if (f.type === "ready") {
      setStage("live");
      setSince((s) => s ?? Date.now());
    } else if (f.type === "partial") setPartial(f.text);
    else if (f.type === "state") {
      setTalk(f.state);
      setStage("live");
      setSince((s) => s ?? Date.now());
      if (f.state !== "listening") setPartial("");
    } else if (f.type === "end") finish(END_REASON[f.reason]);
  };

  const start = async () => {
    hungUp.current = false;
    setProblem(undefined);
    setPartial("");
    setSince(undefined);
    setTalk("listening");
    setStage("calling");
    let mic: MediaStream;
    try {
      mic = await openMic();
    } catch {
      setProblem("callCard.mic");
      setStage("ended");
      return;
    }
    const stop = () => {
      for (const track of mic.getTracks()) track.stop();
    };
    let placed: { thread_id: string; ticket: string };
    try {
      placed = await client.call("calls.start", { voice, lang, ...(thread ? { thread } : {}) });
    } catch (err) {
      stop();
      setProblem((err as { code?: string }).code === "conflict" ? "callCard.busy" : "callCard.failed");
      setStage("ended");
      return;
    }
    if (hungUp.current) {
      stop();
      closeCall();
      return;
    }
    calls.set({ live: placed.thread_id, card: { thread: placed.thread_id } });
    go.inboxThread(placed.thread_id);
    try {
      line.current = await openLine(mic, placed.ticket, {
        frame: onFrame,
        closed: (ended) => {
          if (!ended) finish(hungUp.current ? undefined : "callCard.end.network");
        },
      });
    } catch {
      stop();
      finish("callCard.failed");
      return;
    }
    line.current.setMuted(chosen.current.muted);
    line.current.setSound(chosen.current.sound);
    if (hungUp.current) line.current.hangUp();
  };

  const hangUp = () => {
    hungUp.current = true;
    if (line.current) line.current.hangUp();
    else closeCall();
  };

  const ready = status?.ready !== false;
  const missing = !ready && status?.missing ? (`callCard.missing.${status.missing}` as const) : undefined;
  const busy = stage === "calling" || stage === "preparing" || stage === "live";
  const state =
    stage === "calling"
      ? t("callCard.calling")
      : stage === "preparing"
        ? t("callCard.preparing")
        : stage === "live"
          ? t(`callCard.${talk}`)
          : stage === "ended"
            ? t("callCard.ended")
            : t("call.start", { name });

  return (
    <section
      className="callcard"
      aria-label={t("callCard.label", { name })}
      data-stage={stage}
      data-talk={stage === "live" ? talk : undefined}
    >
      <div className="callcard__head">
        <span className="callcard__face" aria-hidden="true">
          <Icons.Phone size={16} />
        </span>
        <div className="callcard__who">
          <div className="callcard__name">{name}</div>
          <div className="callcard__state" aria-live="polite">
            {state}
          </div>
        </div>
        {since !== undefined && busy && <span className="callcard__time">{clock(now - since)}</span>}
        {!busy && <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={closeCall} />}
      </div>
      {stage === "live" && partial && <p className="callcard__caption">{partial}</p>}
      {stage === "preparing" && <p className="callcard__hint">{t("callCard.preparingHint")}</p>}
      {(problem || (missing && !busy)) && (
        <p className="callcard__problem" role="alert">
          {t(problem ?? missing ?? "callCard.failed", { name })}
        </p>
      )}
      {stage === "setup" && (
        <div className="callcard__voice">
          <span>{t("callCard.voice")}</span>
          <SegmentedControl
            size="sm"
            label={t("callCard.voice")}
            value={voice}
            onValueChange={(v) => {
              const next: CallVoice = v === "male" ? "male" : "female";
              setVoice(next);
              saveVoice(next);
            }}
            options={[
              { value: "female", label: t("callCard.female") },
              { value: "male", label: t("callCard.male") },
            ]}
          />
        </div>
      )}
      {busy ? (
        <div className="callcard__controls">
          <IconButton
            variant="secondary"
            shape="circle"
            label={t(muted ? "callCard.unmute" : "callCard.mute")}
            active={muted}
            icon={muted ? <Icons.MicOff size={16} /> : <Icons.Mic size={16} />}
            onClick={() => {
              chosen.current.muted = !muted;
              setMuted(!muted);
              line.current?.setMuted(!muted);
            }}
          />
          <IconButton
            variant="secondary"
            shape="circle"
            label={t(sound ? "callCard.soundOff" : "callCard.soundOn")}
            active={!sound}
            icon={sound ? <Icons.Volume2 size={16} /> : <Icons.VolumeOff size={16} />}
            onClick={() => {
              chosen.current.sound = !sound;
              setSound(!sound);
              line.current?.setSound(!sound);
            }}
          />
          <Button variant="danger" size="sm" leadingIcon={<Icons.PhoneOff size={14} />} onClick={hangUp}>
            {t("callCard.hangUp")}
          </Button>
        </div>
      ) : (
        <Button size="sm" fullWidth leadingIcon={<Icons.Phone size={14} />} disabled={!ready} onClick={start}>
          {stage === "ended" ? t("call.again") : t("callCard.call")}
        </Button>
      )}
    </section>
  );
}

/** Elapsed time as m:ss (h:mm:ss past an hour). */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
