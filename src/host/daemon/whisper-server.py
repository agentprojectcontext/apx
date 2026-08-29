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


_mlx_loaded = False  # mlx_whisper caches models internally; we just track readiness


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


def _silent_clip_path():
    """A one-second 16 kHz mono WAV of near-silence, written to a temp file.

    Deliberately not pure zeroes: a digitally silent clip can be short-circuited
    before the model runs, which is the opposite of what a warmup wants.
    """
    import struct
    import tempfile

    rate, secs = 16000, 1
    frames = rate * secs
    # A whisper of dither — inaudible, but real samples the model must decode.
    pcm = b"".join(struct.pack("<h", (i % 7) - 3) for i in range(frames))
    data_size = len(pcm)
    header = (
        b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
        + b"data" + struct.pack("<I", data_size)
    )
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(header + pcm)
    tmp.close()
    return tmp.name


def _warmup_model():
    """Make the model ready to answer FAST, not merely resident.

    Loading the weights is only half the cost. On MLX the first real
    transcription also compiles the Metal graph, and that half is the expensive
    one: measured on this machine, a freshly loaded model still spent ~10s on
    its first utterance and 0.7s on every one after it. A warmup that stops at
    load_model() therefore moves nothing — the user goes on paying the compile.

    So we transcribe a throwaway clip. It costs the daemon a second at boot and
    takes the stall out of the first thing anyone says.
    """
    global _mlx_loaded, _model
    clip = None
    try:
        if _Handler.backend == "mlx":
            import mlx_whisper  # noqa: F401  (raises ImportError if the stack is missing)
            clip = _silent_clip_path()
            mlx_whisper.transcribe(clip, path_or_hf_repo=_Handler.model_name)
            _mlx_loaded = True
            return True
        _load_model_if_needed(_Handler.model_name, _Handler.device, _Handler.compute_type)
        clip = _silent_clip_path()
        # Consume the generator — faster-whisper decodes lazily.
        segments, _info = _model.transcribe(clip, beam_size=1)
        for _ in segments:
            pass
        return True
    except ImportError:
        raise
    except Exception as e:
        # A warmup that fails is a slow first request, not a broken server.
        print(f"[whisper-server] warmup failed: {e}", file=sys.stderr, flush=True)
        return _mlx_loaded if _Handler.backend == "mlx" else (_model is not None)
    finally:
        if clip:
            try:
                os.unlink(clip)
            except Exception:
                pass


def _transcribe_file(audio_path, language, beam_size):
    """Backend-agnostic transcription → result dict. Raises on failure."""
    global _mlx_loaded
    if _Handler.backend == "mlx":
        import mlx_whisper
        kw = {"path_or_hf_repo": _Handler.model_name}
        if language:
            kw["language"] = language
        r = mlx_whisper.transcribe(audio_path, **kw)
        _mlx_loaded = True
        return {
            "ok": True,
            "text": (r.get("text") or "").strip(),
            "language": r.get("language"),
            "language_probability": None,
            "duration": None,
            "model": _Handler.model_name,
            "compute_type": "mlx-metal",
        }
    m = _load_model_if_needed(_Handler.model_name, _Handler.device, _Handler.compute_type)
    segments, info = m.transcribe(audio_path, beam_size=beam_size, language=language)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return {
        "ok": True,
        "text": text,
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration": round(info.duration, 2) if hasattr(info, "duration") else None,
        "model": _model_name,
        "compute_type": _Handler.compute_type,
    }


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    backend = "faster"   # "faster" (CTranslate2, CPU/CUDA) | "mlx" (Apple Metal)
    model_name = "small"
    device = "cpu"
    compute_type = "int8"

    def log_message(self, fmt, *args):
        pass  # suppress access log; APX daemon handles its own logging

    def _send_json(self, code, body):
        # Swallow BrokenPipe / ConnectionReset — these happen when the daemon
        # times out and aborts the request before we finish responding, and
        # they used to fill the daemon log with multi-page Python tracebacks.
        try:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

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
            # Deliberately does NOT _touch(). A health check is someone asking
            # whether we are alive, not someone using us — and because the
            # desktop window polls /health, counting it as use kept the idle
            # watchdog permanently reset. The server then lived for days
            # holding a port while its weights were long since paged out: it
            # neither died nor stayed warm. Real use (/transcribe, /warmup)
            # is what resets the timer now.
            loaded = _mlx_loaded if _Handler.backend == "mlx" else (_model is not None)
            self._send_json(200, {
                "ok": True,
                "backend": _Handler.backend,
                "model": _model_name or _Handler.model_name,
                "loaded": loaded,
            })
        elif self.path == "/warmup":
            # Eagerly load the model into RAM (no audio needed) and reset the
            # idle timer, so the first real transcription isn't cold. Blocks
            # until the model is loaded the first time; instant once warm.
            _touch()
            with _model_lock:
                try:
                    loaded = _warmup_model()
                    self._send_json(200, {"ok": True, "loaded": loaded, "model": _Handler.model_name, "backend": _Handler.backend})
                except ImportError as e:
                    self._send_json(500, {"ok": False, "error": f"{_Handler.backend} backend not installed: {e}"})
                except Exception as e:
                    self._send_json(500, {"ok": False, "error": f"model load failed: {e}"})
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        # /transcribe_chunk reads raw bytes — must be handled BEFORE _read_body()
        # which would consume rfile for JSON endpoints.
        if self.path == "/transcribe_chunk":
            _touch()
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                self._send_json(400, {"ok": False, "error": "empty body"})
                return
            audio_bytes = self.rfile.read(content_length)
            audio_format = (self.headers.get("X-Audio-Format") or "webm").strip().lstrip(".")
            language_hdr = self.headers.get("X-Language") or None
            language = language_hdr if language_hdr and language_hdr != "auto" else None
            beam_size = int(self.headers.get("X-Beam-Size") or 3)

            with _model_lock:
                import tempfile
                tmp = tempfile.NamedTemporaryFile(suffix=f".{audio_format}", delete=False)
                try:
                    tmp.write(audio_bytes)
                    tmp.close()
                    self._send_json(200, _transcribe_file(tmp.name, language, beam_size))
                except ImportError as e:
                    self._send_json(500, {"ok": False, "error": f"{_Handler.backend} backend not installed: {e}"})
                except Exception as e:
                    self._send_json(500, {"ok": False, "error": f"chunk transcription failed: {e}"})
                finally:
                    try: os.unlink(tmp.name)
                    except Exception: pass
            return

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
                    self._send_json(200, _transcribe_file(audio_path, language, beam_size))
                except ImportError as e:
                    hint = ("pip3 install faster-whisper" if _Handler.backend == "faster"
                            else "pip3 install mlx-whisper")
                    self._send_json(500, {"ok": False, "error": f"{_Handler.backend} backend not installed — run: {hint} ({e})"})
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
    parser.add_argument("--backend", default="faster", choices=["faster", "mlx"])
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", dest="compute_type", default="int8")
    parser.add_argument("--idle-minutes", dest="idle_minutes", type=int, default=10)
    args = parser.parse_args()

    _Handler.backend = args.backend
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
        "backend": args.backend,
        "model": args.model,
        "idle_minutes": args.idle_minutes,
    }), flush=True)

    threading.Thread(target=_watchdog, args=(_idle_seconds,), daemon=True).start()
    _server_ref.serve_forever()


if __name__ == "__main__":
    main()
