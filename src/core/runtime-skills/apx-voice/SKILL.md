---
name: apx-voice
scope: optional
description: APX TTS — Piper (local), ElevenLabs/OpenAI/Gemini (cloud), unified /voice/turn channel, `apx voice` CLI. Load when the user wants to speak with APX, configure a voice engine, or troubleshoot silent output.
---

# apx-voice

TTS facade in `core/voice/` with five engines. STT lives separately in `host/daemon/transcription.js` (Whisper). The "voice channel" combines both for mic→agent→speaker.

## Engines

| id | Local? | Needs key? | Notes |
|---|---|---|---|
| `piper`      | yes | no  | Local, offline. Requires `piper` CLI + `.onnx` model. es_AR-daniela-high recommended. |
| `elevenlabs` | no  | yes | Excellent. Free tier 10k chars/mo. `eleven_multilingual_v2`. |
| `openai`     | no  | yes | Reuses `engines.openai.api_key`. `tts-1`. |
| `gemini`     | no  | yes | Returns raw L16 PCM — APX wraps in WAV automatically. |
| `mock`       | yes | no  | Silent WAV; placeholder for tests. |

`auto` probes: piper → elevenlabs → openai → gemini → mock.

## Concrete CLI calls

```bash
apx voice providers                              # what's configured + available
apx voice say "Hello from APX" --provider piper
apx voice say "Hello from APX" --provider gemini --voice Aoede
apx voice say "..." --no-play                    # generate WAV, don't play

apx voice listen                                 # mic → STT, records until silence (sox) or Ctrl+C
apx voice listen --seconds 5                     # fixed-duration capture
apx voice listen --provider <id>                 # override STT provider
```

Playback uses system binaries (`afplay`, `paplay`, `aplay`, `play`, `ffplay`). If none found, you get the file path and no playback.

## Configuration

`~/.apx/config.json → voice.tts.<engine>`:

```json
{
  "voice": {
    "tts": {
      "provider": "gemini",
      "piper":      { "bin": "piper", "model": "/Users/.../es_AR-daniela-high.onnx" },
      "elevenlabs": { "api_key": "...", "model": "eleven_multilingual_v2", "voice_id": "..." },
      "openai":     { "api_key": "...", "model": "tts-1", "voice": "alloy", "format": "mp3" },
      "gemini":     { "api_key": "...", "model": "gemini-2.5-flash-preview-tts", "voice": "Aoede" }
    }
  }
}
```

`apx config set voice.tts.provider <name>` to switch.

## Quick setup: Piper local (recommended, no internet)

```bash
# 1. Install binary (macOS arm64)
curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_macos_aarch64.tar.gz \
  -o /tmp/piper.tar.gz
sudo tar xzf /tmp/piper.tar.gz -C /usr/local/bin --strip-components=1

# 2. Voice model (es_AR, "daniela")
mkdir -p ~/.apx/voices && cd ~/.apx/voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx.json

# 3. Configure + test
apx config set voice.tts.provider piper
apx config set voice.tts.piper.model "$HOME/.apx/voices/es_AR-daniela-high.onnx"
apx voice say "hola, soy APX" --provider piper
```

## Quick setup: Gemini cloud

```bash
apx config set voice.tts.provider gemini
apx config set voice.tts.gemini.api_key '<GEMINI_KEY>'
apx config set engines.gemini.api_key   '<GEMINI_KEY>'    # reuse for LLM router
apx voice say "Hello from APX" --provider gemini
```

## Unified voice channel

`POST /voice/turn` is one round-trip: send audio (or text), get back `{ user_text, reply_text, reply_audio_path }`. STT in, agent loop, TTS out. For overlay and future "voice room" clients.

```bash
curl -X POST http://127.0.0.1:7430/voice/turn \
  -H "Authorization: Bearer $(cat ~/.apx/daemon.token)" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello APX","channel":"voice"}'
```

Telegram voice messages and overlay mascot still have their own STT pipelines — they don't go through `/voice/turn` yet.

## Anti-examples

- DON'T trust `apx voice providers` saying "mock available" as green light — mock is silence. Configure a real provider.
- DON'T set `voice.tts.provider` to a provider with no key. It falls through `auto` to the next, but that's not what you asked.
- DON'T expect Gemini TTS to return MP3 — it returns raw L16 PCM; APX wraps in WAV. Files are `.wav`, mime `audio/wav`. Convert with ffmpeg if you need MP3.

## Troubleshooting silent output

1. `apx voice providers` — what's actually available?
2. `apx voice say "test" --provider <engine> --no-play` — file exists?
3. `file <path>` — valid container? Gemini output should be `RIFF WAVE Microsoft PCM`.
4. `afplay <path>` — does the OS player open it?
5. If 3 fails for Gemini, you may be on APX before the PCM-wrap fix (commit `ba5c416`+).

## Don't

- Paste base64 audio into chat. Use file paths or `send_voice` / `send_audio`.
- Switch providers mid-routine without testing — quality varies a lot across Piper voices and cloud engines.
- Expect TTS streaming yet — `apx voice say` returns a complete file. `/tts/stream` is open work.
