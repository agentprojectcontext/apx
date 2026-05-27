---
name: apx-voice
description: How APX handles voice — TTS engines (Piper local, ElevenLabs / OpenAI / Gemini cloud), the unified /voice/turn channel, and apx voice CLI. Load when the user wants to speak with APX, configure a voice engine, or troubleshoot silent output.
---

# apx-voice

APX has a Text-to-Speech (TTS) facade in `core/voice/` with five engines. STT (speech-to-text) lives separately in `host/daemon/transcription.js` (Whisper). The "voice channel" combines both for a full mic→agent→speaker turn.

## Engines

| id | Local? | Needs key? | Quality | Notes |
|---|---|---|---|---|
| `piper`      | yes | no  | Good (es_AR-daniela-high recommended) | Local, offline. Requires `piper` CLI + `.onnx` voice model. |
| `elevenlabs` | no  | yes | Excellent | Free tier 10k chars/mo. `eleven_multilingual_v2`. |
| `openai`     | no  | yes | Good | Reuses `engines.openai.api_key`. `tts-1`. |
| `gemini`     | no  | yes | Good | Returns raw L16 PCM — APX wraps in WAV automatically. |
| `mock`       | yes | no  | Silent | Silent WAV; placeholder for tests. |

`auto` provider probes in order: piper → elevenlabs → openai → gemini → mock.

## Concrete CLI calls

```bash
# Inspect what's configured + available
apx voice providers

# Synthesize and play
apx voice say "Hola Manú" --provider piper
apx voice say "Hola Manú" --provider gemini
apx voice say "..." --no-play          # generate WAV, don't play

# Listen (mic → STT)
apx voice listen                       # records until silence (sox) or Ctrl+C
apx voice listen --seconds 5           # fixed-duration capture
```

Playback uses system binaries (`afplay`, `paplay`, `aplay`, `play`, `ffplay`) — APX doesn't bundle an audio runtime. If none is found, you get the file path and no playback.

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

## Quick setup paths

### Piper local (recommended, no internet)

```bash
# 1. Install binary (macOS arm64)
curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_macos_aarch64.tar.gz \
  -o /tmp/piper.tar.gz
sudo tar xzf /tmp/piper.tar.gz -C /usr/local/bin --strip-components=1

# 2. Voice model (es_AR — Argentine Spanish, daughter)
mkdir -p ~/.apx/voices
cd ~/.apx/voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx.json

# 3. APX config
apx config set voice.tts.provider piper
apx config set voice.tts.piper.model "$HOME/.apx/voices/es_AR-daniela-high.onnx"

# 4. Test
apx voice say "hola Manú" --provider piper
```

### Gemini cloud (quick if you already have a key)

```bash
apx config set voice.tts.provider gemini
apx config set voice.tts.gemini.api_key '<GEMINI_KEY>'
apx config set engines.gemini.api_key   '<GEMINI_KEY>'    # reuse for LLM router
apx voice say "hola Manú" --provider gemini
```

## The unified voice channel

`POST /voice/turn` is one round-trip: send audio (or text), get back `{ user_text, reply_text, reply_audio_path }`. STT in, agent loop, TTS out. Surface for the overlay and any future "voice room" client.

```bash
# Drive from curl with already-transcribed text (skip STT)
curl -X POST http://127.0.0.1:7430/voice/turn \
  -H "Authorization: Bearer $(cat ~/.apx/daemon.token)" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hola APX","channel":"voice"}'
```

Telegram voice messages and the overlay mascot still have their own STT pipelines today — they don't go through `/voice/turn` (yet). The endpoint exists for callers that want one-shot bidirectional voice.

## Anti-examples

```bash
# DON'T trust `apx voice providers` saying "mock available" as a green light.
# Mock is silence; useful for tests, useless for talking to humans.
# If only mock is "available", configure a real provider.

# DON'T set voice.tts.provider to a provider with no key.
# It will fall through `auto` to the next, but that's not what you asked for.

# DON'T expect Gemini TTS to give you an MP3.
# Today it returns raw L16 PCM. APX wraps it in a 44-byte WAV header so afplay
# accepts it. Files are .wav, mime "audio/wav". If you need MP3, convert with ffmpeg.
```

## Troubleshooting silent output

1. `apx voice providers` — what's actually available?
2. `apx voice say "test" --provider <engine> --no-play` — does the file exist?
3. `file <path>` — is it a valid container? Gemini's output should be `RIFF WAVE Microsoft PCM`.
4. `afplay <path>` directly — does the OS player open it?
5. If 3 fails for Gemini, you may be on an older APX before the PCM-wrap fix (commit `ba5c416` or later).

## Don't

- Don't paste base64 audio into chat. Use file paths or upload via `send_voice` / `send_audio`.
- Don't switch providers mid-routine without testing — voice quality varies a lot between Piper voices and cloud engines.
- Don't expect TTS streaming yet — `apx voice say` returns a complete file. A `/tts/stream` endpoint with chunked audio is open work.
