#!/usr/bin/env python3
"""
Local audio transcription via faster-whisper. Mirrors the implementation in
the Panda project (transcription_service.py): same default model "medium",
device cpu, compute_type int8, beam_size 5. Lazy singleton model cache.

Invoked by APX daemon (Node) as a subprocess. Args:
  whisper-transcribe.py <audio_path> [--model medium] [--language auto] [--device cpu] [--compute-type int8] [--beam-size 5]

Outputs JSON on stdout:
  { "ok": true,  "text": "...", "language": "es", "language_probability": 0.98, "duration": 12.4 }
  { "ok": false, "error": "..." }
"""
import argparse
import json
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="medium")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", dest="compute_type", default="int8")
    parser.add_argument("--beam-size", dest="beam_size", type=int, default=5)
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"ok": False, "error": f"file not found: {args.audio_path}"}))
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(json.dumps({
            "ok": False,
            "error": "faster-whisper not installed. Run: pip3 install faster-whisper",
            "import_error": str(e),
        }))
        return 1

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"failed to load model '{args.model}': {e}"}))
        return 1

    language = None if args.language == "auto" else args.language

    try:
        segments, info = model.transcribe(args.audio_path, beam_size=args.beam_size, language=language)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        print(json.dumps({
            "ok": True,
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(info.duration, 2),
            "model": args.model,
            "compute_type": args.compute_type,
        }))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"transcription failed: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
