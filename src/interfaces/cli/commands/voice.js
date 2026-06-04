// apx voice — TTS playback, voice-channel one-shot, and provider listing.
//
//   apx voice say "<text>" [--provider <id>] [--voice <id>] [--no-play]
//   apx voice listen [--seconds N] [--provider <id>] [--no-play]
//   apx voice providers
//
// Uses system CLI binaries (afplay / aplay / paplay / play, sox / arecord)
// instead of npm audio packages so the deps footprint stays light. If no
// playback binary is found we print the path so the user can play it
// themselves.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { http } from "../http.js";

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m",
};
const fmt = {
  b: (s) => `${c.bold}${s}${c.reset}`,
  d: (s) => `${c.dim}${s}${c.reset}`,
  g: (s) => `${c.green}${s}${c.reset}`,
  r: (s) => `${c.red}${s}${c.reset}`,
  y: (s) => `${c.yellow}${s}${c.reset}`,
  cy:(s) => `${c.cyan}${s}${c.reset}`,
};

// ── System binary discovery ────────────────────────────────────────────────
function whichSync(bin) {
  try {
    const out = execFileSync("which", [bin], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    return out || null;
  } catch { return null; }
}

function findPlayer() {
  if (process.platform === "darwin" && whichSync("afplay")) return { bin: "afplay", args: (p) => [p] };
  if (whichSync("paplay")) return { bin: "paplay", args: (p) => [p] };
  if (whichSync("aplay"))  return { bin: "aplay",  args: (p) => ["-q", p] };
  if (whichSync("play"))   return { bin: "play",   args: (p) => ["-q", p] };
  if (whichSync("ffplay")) return { bin: "ffplay", args: (p) => ["-autoexit", "-nodisp", "-loglevel", "quiet", p] };
  return null;
}

function findRecorder() {
  // sox `rec` is the friendliest for silence-stop on macOS+linux.
  if (whichSync("rec")) return { bin: "rec", silenceCapable: true };
  if (whichSync("sox")) return { bin: "sox", silenceCapable: true, soxMode: true };
  if (whichSync("arecord")) return { bin: "arecord", silenceCapable: false };
  if (whichSync("ffmpeg")) return { bin: "ffmpeg", silenceCapable: false };
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function playFile(audioPath, { quiet = false } = {}) {
  const player = findPlayer();
  if (!player) {
    if (!quiet) {
      console.log(`\n  ${fmt.y("⚠")} No audio player found (afplay/aplay/paplay/play/ffplay).`);
      console.log(`  ${fmt.d("Audio saved to:")} ${audioPath}\n`);
    }
    return false;
  }
  const r = spawnSync(player.bin, player.args(audioPath), { stdio: "ignore" });
  if (r.status !== 0 && !quiet) {
    console.log(`  ${fmt.y("⚠")} ${player.bin} exited ${r.status}; file at ${audioPath}`);
  }
  return r.status === 0;
}

function recordToFile(outPath, { seconds, recorder }) {
  // Returns a promise that resolves when recording finishes. Ctrl+C also stops
  // the recorder cleanly (we forward SIGINT to the child).
  return new Promise((resolve, reject) => {
    let args;
    let bin = recorder.bin;
    if (bin === "rec" || bin === "sox") {
      // SoX:
      //   rec -q -c 1 -r 16000 out.wav silence 1 0.1 1% 1 1.5 1%
      //   → record until 1.5s of <1% silence after some speech.
      args = ["-q", "-c", "1", "-r", "16000", outPath];
      if (recorder.soxMode) {
        // `sox` mode: read from default input device.
        args = ["-q", "-d", "-c", "1", "-r", "16000", outPath];
      }
      if (seconds && seconds > 0) {
        args.push("trim", "0", String(seconds));
      } else {
        // Silence detector: first segment is speech (>1% for >0.1s),
        // second segment cuts when silence lasts >1.5s.
        args.push("silence", "1", "0.1", "1%", "1", "1.5", "1%");
      }
    } else if (bin === "arecord") {
      // ALSA: capture WAV mono 16k. No silence detector — must use --seconds.
      args = ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", outPath];
      if (seconds && seconds > 0) args.push("-d", String(seconds));
    } else if (bin === "ffmpeg") {
      // Cross-platform ffmpeg fallback. Best-effort device names.
      const device = process.platform === "darwin"
        ? ["-f", "avfoundation", "-i", ":0"]
        : process.platform === "linux"
        ? ["-f", "pulse", "-i", "default"]
        : ["-f", "dshow", "-i", "audio=default"];
      args = ["-y", "-hide_banner", "-loglevel", "error", ...device,
              "-ac", "1", "-ar", "16000"];
      if (seconds && seconds > 0) args.push("-t", String(seconds));
      args.push(outPath);
    } else {
      return reject(new Error(`unsupported recorder: ${bin}`));
    }

    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => { stderr += c.toString(); });

    const sigint = () => {
      try { proc.kill("SIGINT"); } catch {}
    };
    process.on("SIGINT", sigint);

    proc.on("error", (e) => {
      process.off("SIGINT", sigint);
      reject(e);
    });
    proc.on("exit", (code) => {
      process.off("SIGINT", sigint);
      // SoX returns 0 on graceful stop including SIGINT.
      if (code === 0 || (code === null) || code === 130) return resolve();
      reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

// ── Commands ───────────────────────────────────────────────────────────────

export async function cmdVoiceSay(args) {
  const flags = args.flags || {};
  const text = (args._ || []).join(" ").trim();
  if (!text) {
    console.error(`\n  ${fmt.r("✗")} Missing text.\n  Usage: ${fmt.cy('apx voice say "hola"')}\n`);
    process.exit(1);
  }
  const provider = (typeof flags.provider === "string" && flags.provider) || undefined;
  const voice    = (typeof flags.voice === "string" && flags.voice) || undefined;
  const noPlay   = !!flags["no-play"];

  process.stdout.write(`  ${fmt.d("Synthesizing…")} `);
  let result;
  try {
    result = await http.post("/tts/say", { text, provider, voice });
  } catch (e) {
    console.log(fmt.r("failed"));
    console.error(`  ${fmt.r("✗")} ${e.message}\n`);
    process.exit(1);
  }
  console.log(fmt.g(`ok (${result.provider})`));
  console.log(`  ${fmt.d("File:")}     ${result.audio_path}`);
  if (result.duration_s) console.log(`  ${fmt.d("Duration:")} ${result.duration_s.toFixed(2)}s`);

  if (!noPlay) playFile(result.audio_path);
  console.log();
}

export async function cmdVoiceListen(args) {
  const flags = args.flags || {};
  const seconds = parseInt(flags.seconds || "0", 10) || 0;
  const provider = (typeof flags.provider === "string" && flags.provider) || undefined;
  const noPlay   = !!flags["no-play"];

  const recorder = findRecorder();
  if (!recorder) {
    console.error(
      `\n  ${fmt.r("✗")} No microphone recorder found.\n` +
      `  Install one of: ${fmt.cy("sox")}, ${fmt.cy("arecord")}, ${fmt.cy("ffmpeg")}.\n` +
      `    macOS:  ${fmt.d("brew install sox")}\n` +
      `    Linux:  ${fmt.d("sudo apt install sox  # or alsa-utils")}\n`
    );
    process.exit(1);
  }

  const tmpDir = path.join(os.homedir(), ".apx", "tmp", "recordings");
  fs.mkdirSync(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, `listen-${Date.now()}.wav`);

  if (seconds > 0) {
    console.log(`\n  ${fmt.cy("●")} Recording ${seconds}s via ${recorder.bin}… ${fmt.d("(Ctrl+C to stop early)")}`);
  } else {
    console.log(`\n  ${fmt.cy("●")} Recording via ${recorder.bin}… ${fmt.d("(stops on silence; Ctrl+C to cut)")}`);
  }

  try {
    await recordToFile(inFile, { seconds, recorder });
  } catch (e) {
    console.error(`\n  ${fmt.r("✗")} Recording failed: ${e.message}\n`);
    process.exit(1);
  }

  const stat = fs.existsSync(inFile) ? fs.statSync(inFile) : null;
  if (!stat || stat.size < 1024) {
    console.error(`\n  ${fmt.r("✗")} Recording is empty (${stat?.size ?? 0} bytes). Mic permissions?\n`);
    process.exit(1);
  }

  console.log(`  ${fmt.d("Captured:")} ${inFile} ${fmt.d(`(${stat.size} bytes)`)}`);
  process.stdout.write(`  ${fmt.d("Sending to /voice/turn…")} `);

  const audioB64 = fs.readFileSync(inFile).toString("base64");
  let result;
  try {
    result = await http.post("/voice/turn", {
      audio: audioB64,
      format: "wav",
      provider,
    });
  } catch (e) {
    console.log(fmt.r("failed"));
    console.error(`  ${fmt.r("✗")} ${e.message}\n`);
    process.exit(1);
  }
  console.log(fmt.g("ok"));

  console.log(`\n  ${fmt.b("You said:")}  ${result.user_text || fmt.d("(empty)")}`);
  console.log(`  ${fmt.b("Reply:")}     ${result.reply_text || fmt.d("(empty)")}`);
  if (result.tts_error) {
    console.log(`  ${fmt.y("⚠ TTS error:")} ${result.tts_error}`);
  }

  if (result.reply_audio_path) {
    console.log(`  ${fmt.d("Audio:")}     ${result.reply_audio_path} ${fmt.d(`(${result.provider})`)}`);
    if (!noPlay) playFile(result.reply_audio_path);
  }
  console.log();
}

export async function cmdVoiceProviders() {
  let info;
  try {
    info = await http.get("/tts/providers");
  } catch (e) {
    console.error(`\n  ${fmt.r("✗")} ${e.message}\n`);
    process.exit(1);
  }
  console.log(`\n  ${fmt.b("APX TTS providers")}`);
  console.log(`  ${fmt.d("Configured:")} ${fmt.cy(info.configured_provider || "auto")}\n`);
  for (const e of info.engines || []) {
    const dot = e.available ? fmt.g("●") : fmt.d("○");
    const note = e.available
      ? fmt.g("available")
      : e.configured ? fmt.y("configured, unavailable") : fmt.d("not configured");
    console.log(`    ${dot} ${e.id.padEnd(12)} ${note}`);
  }
  console.log();
}
