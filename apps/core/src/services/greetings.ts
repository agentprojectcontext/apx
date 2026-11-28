// The greeting a phone or computer plays the moment it hears its name: recorded ahead in the current voice and language,
// so nobody waits for the voice to load before hearing it answer. See DECISIONS.md#d-287
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CallMode, VoiceLocale } from "@apx/protocol";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";

/** What a greeting is recorded with: a change in any of it records it again. */
export type GreetingVoice = {
  locale: VoiceLocale;
  gender: "female" | "male";
  owner: string;
  engine: "native" | "services";
  service?: string | undefined;
};

const LINES: Record<CallMode, Record<VoiceLocale, (owner: string) => string>> = {
  quick: {
    "es-AR": (o) => `¿Sí${o ? `, ${o}` : ""}?`,
    es: (o) => `¿Sí${o ? `, ${o}` : ""}?`,
    "en-US": (o) => `Yes${o ? `, ${o}` : ""}?`,
  },
  call: {
    "es-AR": (o) => `Hola${o ? ` ${o}` : ""}, ¿en qué te ayudo?`,
    es: (o) => `Hola${o ? ` ${o}` : ""}, ¿en qué te puedo ayudar?`,
    "en-US": (o) => `Hi${o ? ` ${o}` : ""}, what can I do for you?`,
  },
};

/** What the voice says first: the same words whether a device played them ahead or the voice says them itself. */
export const greetingLine = (mode: CallMode, locale: VoiceLocale, owner: string) =>
  (LINES[mode][locale] ?? LINES[mode]["es-AR"])(owner.trim().split(/\s+/)[0] ?? "");

const SAMPLE_RATE = 24_000;

/** Mono 16-bit PCM with its WAV header. */
export function pcmWav(pcm: Buffer, rate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** The samples of a WAV (its `data` chunk), or the bytes as they are when they have no RIFF header. */
export function wavPcm(wav: Buffer): Buffer {
  if (wav.subarray(0, 4).toString() !== "RIFF") return wav;
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.subarray(at, at + 4).toString();
    const size = wav.readUInt32LE(at + 4);
    if (id === "data") return wav.subarray(at + 8, Math.min(wav.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  return Buffer.alloc(0);
}

const RETRY_MS = 5 * 60_000;
const RECORD_MS = 120_000;
const MODES: CallMode[] = ["quick", "call"];

export function createGreetings(deps: {
  dir: string;
  voice: () => GreetingVoice;
  /** The line spoken in the voice, as 24 kHz mono PCM16. */
  record: (text: string, v: GreetingVoice, signal: AbortSignal) => Promise<Buffer>;
  log: Log;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const busy = new Map<CallMode, string>();
  const failed = new Map<string, number>();

  const describe = (mode: CallMode) => {
    const v = deps.voice();
    const text = greetingLine(mode, v.locale, v.owner);
    const key = crypto
      .createHash("sha256")
      .update(JSON.stringify([mode, text, v.locale, v.gender, v.engine, v.service ?? ""]))
      .digest("hex")
      .slice(0, 16);
    return { v, text, key, file: path.join(deps.dir, `${mode}-${key}.pcm`) };
  };
  const files = () => {
    try {
      return fs.readdirSync(deps.dir).filter((f) => f.endsWith(".pcm"));
    } catch {
      return [];
    }
  };
  /** The kinds of greeting some device asked for: only those are recorded again when the voice changes. */
  const inUse = () => MODES.filter((m) => files().some((f) => f.startsWith(`${m}-`)));

  function record(mode: CallMode) {
    const g = describe(mode);
    if (fs.existsSync(g.file) || busy.get(mode) === g.key) return;
    const last = failed.get(g.key);
    if (last !== undefined && now() - last < RETRY_MS) return;
    busy.set(mode, g.key);
    void (async () => {
      try {
        const pcm = await deps.record(g.text, g.v, AbortSignal.timeout(RECORD_MS));
        if (!pcm.length) throw new Error("the voice returned no audio");
        fs.mkdirSync(deps.dir, { recursive: true });
        fs.writeFileSync(`${g.file}.tmp`, pcm);
        fs.renameSync(`${g.file}.tmp`, g.file);
        for (const f of files())
          if (f.startsWith(`${mode}-`) && path.join(deps.dir, f) !== g.file)
            fs.rmSync(path.join(deps.dir, f), { force: true });
        failed.delete(g.key);
      } catch (err) {
        failed.set(g.key, now());
        deps.log.warn({ err: errorMessage(err, 200), mode }, "greeting not recorded");
      } finally {
        if (busy.get(mode) === g.key) busy.delete(mode);
      }
    })();
  }

  /** Records again what devices use after the voice, its language or the owner's name changed. */
  const refresh = () => {
    for (const m of inUse()) record(m);
  };

  return {
    refresh,
    /** The greeting for `mode` when it is recorded; otherwise it starts recording it and says so. */
    get(mode: CallMode): { key: string; text: string; pcm?: Buffer } {
      const g = describe(mode);
      try {
        return { key: g.key, text: g.text, pcm: fs.readFileSync(g.file) };
      } catch {
        record(mode);
        return { key: g.key, text: g.text };
      }
    },
    /** Absent until a device asks for a greeting; `preparing` while one in use is recorded again. */
    status(): "ready" | "preparing" | undefined {
      const used = inUse();
      if (!used.length && !busy.size) return undefined;
      refresh();
      return used.every((m) => fs.existsSync(describe(m).file)) && !busy.size ? "ready" : "preparing";
    },
  };
}

export type Greetings = ReturnType<typeof createGreetings>;
