import { useEffect } from "react";
import { callScene, calls, openCall, useCalls } from "../data/calls.ts";
import { client } from "../data/client.ts";
import { upWorklet } from "./callLine.ts";
import { loadCallStatus } from "./callStatus.ts";
import { stopWake } from "./wakeSwitch.ts";
import { base64, createSegmenter, encodeWav, FRAME_SAMPLES, worthChecking } from "./wakeVad.ts";

/**
 * Listens on this computer for the voice's name ("ok Roby") while no call goes on, and then calls the super-agent for
 * one request. Mounted only while the switch in Settings is on; unmounting lets the microphone go.
 */
export function WakeListener() {
  const ready = useCalls((s) => s.status?.ready === true && !s.status.live);
  useEffect(() => {
    if (!calls.get().status) void loadCallStatus();
  }, []);
  useEffect(() => (ready ? listen() : undefined), [ready]);
  return null;
}

function listen(): () => void {
  let stopped = false;
  let mic: MediaStream | undefined;
  let ctx: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let checking = false;
  let lastCheck: number | undefined;
  const segmenter = createSegmenter();

  // Without a click since the page loaded, the audio waits for the next one.
  const wakeAudio = () => void ctx?.resume().catch(() => undefined);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointerdown", wakeAudio);
    window.removeEventListener("keydown", wakeAudio);
    if (node) node.port.onmessage = null;
    for (const track of mic?.getTracks() ?? []) track.stop();
    void ctx?.close().catch(() => undefined);
  };

  const check = async (clip: Int16Array) => {
    const now = Date.now();
    if (checking || !worthChecking(clip.length, lastCheck, now)) return;
    checking = true;
    lastCheck = now;
    try {
      const heard = await client.call("voice.wake", { data: base64(encodeWav(clip)), mime: "audio/wav" });
      if (heard.awake && !stopped && callScene(calls.get()) === "quiet") {
        stop();
        openCall({ mode: "quick" });
      }
    } catch (err) {
      if ((err as { code?: string }).code === "unavailable") {
        stop();
        stopWake("unavailable");
      }
    } finally {
      checking = false;
    }
  };

  void (async () => {
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      });
    } catch {
      if (!stopped) stopWake("mic");
      return;
    }
    if (stopped) {
      for (const track of mic.getTracks()) track.stop();
      return;
    }
    try {
      ctx = new AudioContext();
      const url = URL.createObjectURL(
        new Blob([upWorklet("apx-wake", FRAME_SAMPLES)], { type: "application/javascript" }),
      );
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (stopped) return;
      const source = ctx.createMediaStreamSource(mic);
      node = new AudioWorkletNode(ctx, "apx-wake", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const clip = segmenter.push(new Int16Array(e.data));
        if (clip) void check(clip);
      };
      source.connect(node);
      if (ctx.state === "suspended") {
        window.addEventListener("pointerdown", wakeAudio);
        window.addEventListener("keydown", wakeAudio);
        wakeAudio();
      }
    } catch {
      stop();
      stopWake("mic");
    }
  })();

  return stop;
}
