#!/usr/bin/env python3
"""
Persistent Whisper transcription server for APX.

Loads the model once on the first /transcribe request and keeps it in RAM.
Auto-shuts down after --idle-minutes of inactivity so it doesn't consume
memory permanently when not in use.

Started automatically by APX daemon via transcription.js. Do not run manually.

Endpoints:
  GET  /health      → { ok, model, loaded }
  POST /transcribe  ← { audio_path, language?, beam_size? }
                    → { ok, text, language, language_probability, duration, model, compute_type }
  POST /shutdown    → graceful stop
"""
import argparse
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

_model = None
_model_name = None
_model_lock = threading.Lock()
_last_used = time.monotonic()
_idle_seconds = 10 * 60
_server_ref = None


def _touch():
    global _last_used
    _last_used = time.monotonic()


def _load_model_if_needed(model_name, device, compute_type):
    global _model, _model_name
    if _model is not None and _model_name == model_name:
        return _model
    from faster_whisper import WhisperModel
    threads = os.cpu_count() or 4
    m = WhisperModel(model_name, device=device, compute_type=compute_type, cpu_threads=threads)
    _model = m
    _model_name = model_name
    return m


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    model_name = "small"
    device = "cpu"
    compute_type = "int8"

    def log_message(self, fmt, *args):
        pass  # suppress access log; APX daemon handles its own logging

    def _send_json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except Exception:
            return {}

    def do_GET(self):
        if self.path == "/health":
            _touch()
            self._send_json(200, {
                "ok": True,
                "model": _model_name or _Handler.model_name,
                "loaded": _model is not None,
            })
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        req = self._read_body()

        if self.path == "/transcribe":
            _touch()
            audio_path = req.get("audio_path", "")
            language = req.get("language") or None  # None → auto-detect
            beam_size = int(req.get("beam_size", 5))

            if not audio_path or not os.path.exists(audio_path):
                self._send_json(400, {"ok": False, "error": f"file not found: {audio_path}"})
                return

            with _model_lock:
                try:
                    m = _load_model_if_needed(_Handler.model_name, _Handler.device, _Handler.compute_type)
                except ImportError:
                    self._send_json(500, {
                        "ok": False,
                        "error": "faster-whisper not installed — run: pip3 install faster-whisper",
                    })
                    return
                except Exception as e:
                    self._send_json(500, {"ok": False, "error": f"model load failed: {e}"})
                    return

                try:
                    segments, info = m.transcribe(audio_path, beam_size=beam_size, language=language)
                    text = " ".join(seg.text.strip() for seg in segments).strip()
                    self._send_json(200, {
                        "ok": True,
                        "text": text,
                        "language": info.language,
                        "language_probability": round(info.language_probability, 4),
                        "duration": round(info.duration, 2),
                        "model": _model_name,
                        "compute_type": _Handler.compute_type,
                    })
                except Exception as e:
                    self._send_json(500, {"ok": False, "error": f"transcription failed: {e}"})

        elif self.path == "/shutdown":
            self._send_json(200, {"ok": True})
            if _server_ref:
                threading.Thread(target=_server_ref.shutdown, daemon=True).start()

        else:
            self._send_json(404, {"ok": False, "error": "not found"})


# ---------------------------------------------------------------------------
# Idle watchdog
# ---------------------------------------------------------------------------

def _watchdog(idle_seconds):
    while True:
        time.sleep(30)
        idle = time.monotonic() - _last_used
        if idle > idle_seconds:
            print(
                f"[whisper-server] idle {int(idle)}s > {idle_seconds}s — shutting down",
                file=sys.stderr,
                flush=True,
            )
            if _server_ref:
                _server_ref.shutdown()
            return


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global _server_ref, _idle_seconds

    parser = argparse.ArgumentParser(description="Persistent APX Whisper server")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", dest="compute_type", default="int8")
    parser.add_argument("--idle-minutes", dest="idle_minutes", type=int, default=10)
    args = parser.parse_args()

    _Handler.model_name = args.model
    _Handler.device = args.device
    _Handler.compute_type = args.compute_type
    _idle_seconds = args.idle_minutes * 60

    try:
        _server_ref = HTTPServer(("127.0.0.1", args.port), _Handler)
    except OSError as e:
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        sys.exit(1)

    # Signal readiness to the Node.js parent before serve_forever blocks.
    print(json.dumps({
        "status": "ready",
        "port": args.port,
        "model": args.model,
        "idle_minutes": args.idle_minutes,
    }), flush=True)

    threading.Thread(target=_watchdog, args=(_idle_seconds,), daemon=True).start()
    _server_ref.serve_forever()


if __name__ == "__main__":
    main()
