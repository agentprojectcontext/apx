# 004 — Piper is the recommended local TTS engine

**Date**: 2026-05-27
**Status**: accepted

## Context

APX has five TTS engines: piper (local), elevenlabs (cloud, free tier), openai (cloud, ~$15/M chars), gemini (experimental), mock (silent placeholder). Out of the box on a fresh install no real engine is configured, so `--provider auto` falls back to `mock`, which produces silence.

We need a recommended default that:
- Doesn't require an API key.
- Works offline.
- Has acceptable Spanish (especially Argentine Spanish) voice quality.
- Aligns with the local-first philosophy of APX.

## Decision

**Piper is the recommended default**. Cloud engines remain first-class options for users who prefer them.

- Recommended voice for Argentine users: `es_AR-daniela-high.onnx` (Hugging Face: `rhasspy/piper-voices/es/es_AR/daniela/high/`). It is the highest-quality Argentine Spanish voice currently published.
- The setup wizard (`apx setup`) prompts for TTS; piper is option 2 (after "auto") with a short explanation of the install step.
- A future skill (`tts-setup`) walks users through downloading the piper binary and a voice model. See backlog item 07.

## Implementation

No code change beyond documentation. The auto selector already prefers piper when available (`piper → elevenlabs → openai → gemini → mock`).

## Consequences

- "Out of the box `mock` is silence" is documented as expected behavior, not a bug.
- The path to real voice is: install piper binary + download one `.onnx` model + `apx config set voice.tts.provider piper`. That's the README path.

## Supersedes / superseded by

None.
