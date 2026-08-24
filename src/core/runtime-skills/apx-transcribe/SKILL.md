---
name: apx-transcribe
scope: optional
description: Transcribe audio and video files to text from the command line with `apx transcribe`, using the daemon's built-in Whisper. Load when asked to transcribe a voice note, an audio clip, or a video's speech, to batch-transcribe a folder, to pipe transcription into a script, or when choosing between the local, cloud, or a networked custom STT engine.
---

# apx-transcribe

`apx transcribe` is a thin CLI over the daemon's speech-to-text engine — the same persistent `whisper-server.py` that powers the desktop overlay and Telegram voice notes (`core/voice/transcription.js`). The model is preloaded at daemon boot, so calls hit a warm server and stay fast. This is the fastest way to turn a file on disk into text without writing any HTTP.

## Usage

```bash
apx transcribe nota.oga                 # transcript to stdout, nothing else
apx transcribe reunion.mp4              # video: the audio track is extracted
apx transcribe a.wav b.m4a c.mp3        # bulk: one "── name ──" block per file
apx transcribe ./notas-de-voz/          # every audio/video file in a folder
apx transcribe voz.webm --lang es       # pin the language (else auto-detect)
apx transcribe *.mp3 --json > out.json  # machine-readable array
cat clip.wav | apx transcribe -         # read audio from stdin
```

## Formats

Audio: `webm`, `ogg`/`oga`, `opus`, `m4a`, `aac`, `mp3`, `wav`, `flac`. Video: `mp4`, `mov`, `mkv`, `m4v`, `avi`, `3gp` and more. The daemon shells out to `ffmpeg`, which probes the real container from the bytes and pulls the audio track out of a video — so the extension is only a hint, and a mislabelled file still works.

## Provider routing (`--provider`)

The `--provider` flag overrides the configured STT routing for one call:

| id | What it is |
|---|---|
| `local`  | The embedded Whisper. On Apple Silicon it runs on `mlx` (Metal GPU), on NVIDIA on `faster-whisper` cuda, else CPU — picked automatically. |
| `openai` | Cloud Whisper (`whisper-1`). Needs `OPENAI_API_KEY` or `engines.openai.api_key`. |
| `custom` | Any OpenAI-compatible STT server reachable over the network — mlx-audio on this Mac, a Radeon/NVIDIA box on the LAN, or a remote endpoint. Configured under `transcription.custom.base_url`. |

Default routing lives in `~/.apx/config.json` under `transcription.provider` (`auto` tries local first, falls back to OpenAI if a key is set).

## Output contract (why it is scriptable)

- **One file** → the bare transcript on **stdout**, one trailing newline. Pipe-friendly: `apx transcribe x.oga | pbcopy` copies clean text.
- **Many files / a folder** → a `── filename ──` header before each transcript.
- **`--json`** → the full result object (`text`, `language`, `backend`, `model`, …) for one file, or an array of `{file, ...}` in bulk.
- The `▸ APX CLI` banner always goes to **stderr**, never stdout.
- Bulk runs **sequentially** (the local model is single-instance) and keeps going past a failed file, exiting non-zero if any failed.

## How it works

The CLI reads the file bytes and POSTs them to the daemon's `POST /api/transcribe/chunk` with `X-Audio-Format`, `X-Language`, and optional `X-Provider` headers. That endpoint is the shared "any external caller" entry point, so a routine's `pre_command`, a hook, or a plain shell script all get the same warm engine without spawning their own Whisper. Long media is allowed up to 20 minutes per request.

## Don't

- Don't spin up a separate Whisper process or a Python script to transcribe — the daemon already runs a warm one; `apx transcribe` reuses it. A parallel instance just fights for the GPU.
- Don't restart the daemon to "load" the model before transcribing — it is preloaded at boot, and the endpoint lazily re-spawns it after the idle-shutdown anyway.
- Don't pre-extract audio from a video before transcribing it — pass the video directly; the daemon's ffmpeg handles the audio track.
- Don't parse the human transcript when you need fields — use `--json` and read `text`, never scrape stdout for the language or model.
