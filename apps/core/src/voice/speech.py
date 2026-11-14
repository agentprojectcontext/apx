"""The voice engine's ears and mouth: voice activity, end of turn, transcription and APX's own voices.

Each part loads the first time it is needed: a voice note only loads the mouth, a transcription only the ears.

Each MLX model (whisper, Qwen3-TTS) always runs on its own thread: MLX keeps per-thread state, and a thread apiece
means hearing the owner never waits for a line being spoken. The small ONNX models and the CPU whisper for live
captions run on threads of their own.
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

SR_IN, SR_OUT = 16000, 24000
FRAME = 512  # 32 ms at 16 kHz: what the VAD model takes
LANGS = {"es": "spanish", "en": "english"}
VOICES = Path(__file__).parent / "voices"

# What each tier runs (VOICE_TIER, services/voice-engine.ts): "light" fits a Mac with less memory. Changing a model
# means bumping MODELS_REV there, so machines that have the old ones get the new ones before they are used.
MODELS = {
    "full": {"tts": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "stt": "mlx-community/whisper-large-v3-turbo",
             "draft": "Systran/faster-whisper-base"},
    "light": {"tts": "Qwen/Qwen3-TTS-12Hz-0.6B-Base", "stt": "mlx-community/whisper-large-v3-turbo-q4",
              "draft": "Systran/faster-whisper-base"},
}
SMALL = [("onnx-community/silero-vad", "onnx/model.onnx"), ("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-cpu.onnx")]


def tier():
    return MODELS.get(os.environ.get("VOICE_TIER", "full"), MODELS["full"])

hearing = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-whisper")
speaking = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-tts")
cpu = ThreadPoolExecutor(max_workers=2, thread_name_prefix="cpu")


def _hf(repo, file):
    from huggingface_hub import hf_hub_download
    return hf_hub_download(repo, file)


class Vad:
    """Silero VAD (MIT, onnx-community/silero-vad): speech probability per 32 ms frame."""

    def __init__(self):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(_hf("onnx-community/silero-vad", "onnx/model.onnx"), opts,
                                            providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}

    def stream(self):
        return VadStream(self)


class VadStream:
    CONTEXT = 64  # samples of the previous frame the model expects in front of each one

    def __init__(self, vad):
        self.vad, self.state = vad, np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros(self.CONTEXT, dtype=np.float32)

    def prob(self, frame):
        x = np.concatenate([self.context, frame])[None, :].astype(np.float32)
        self.context = frame[-self.CONTEXT:]
        feed = {"input": x, "state": self.state, "sr": np.array(SR_IN, dtype=np.int64)}
        out, self.state = self.vad.session.run(None, {k: v for k, v in feed.items() if k in self.vad.inputs})
        return float(out.reshape(-1)[0])


class EndOfTurn:
    """smart-turn v3 (BSD-2, pipecat-ai/smart-turn-v3): has the speaker finished, from the last 8 s of their audio."""

    SECONDS = 8

    def __init__(self):
        import onnxruntime as ort
        from transformers import WhisperFeatureExtractor
        self.session = ort.InferenceSession(_hf("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-cpu.onnx"),
                                            providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        self.features = WhisperFeatureExtractor(chunk_length=self.SECONDS)

    def prob(self, audio):
        n = self.SECONDS * SR_IN
        audio = audio[-n:]
        audio = np.pad(audio, (n - len(audio), 0)) if len(audio) < n else audio
        f = self.features(audio, sampling_rate=SR_IN, return_tensors="np", padding="max_length", max_length=n,
                          truncation=True, do_normalize=True)
        out = self.session.run(None, {self.input: f.input_features.astype(np.float32)})[0]
        p = float(np.asarray(out).reshape(-1)[0])
        return p if 0 <= p <= 1 else float(1 / (1 + np.exp(-p)))


class Ears:
    """whisper large-v3-turbo on MLX for what was said; a small CPU whisper for what is being said."""

    def __init__(self, model, draft):
        import mlx_whisper  # noqa: F401  (loaded on its thread at the first call)
        self.model, self.draft_id, self._draft = model, draft, None
        self.draft_lock = threading.Lock()

    @property
    def draft(self):
        """The CPU whisper for live captions: only calls need it."""
        if self._draft is None:
            from faster_whisper import WhisperModel
            self._draft = WhisperModel(self.draft_id, device="cpu", compute_type="int8", cpu_threads=4)
        return self._draft

    def _final(self, pcm, lang, prompt):
        import mlx_whisper
        r = mlx_whisper.transcribe(pcm, path_or_hf_repo=self.model, language=lang, initial_prompt=prompt,
                                   condition_on_previous_text=False, without_timestamps=True, verbose=None)
        return r["text"].strip(), r.get("language") or lang

    def _partial(self, pcm, lang, prompt):
        with self.draft_lock:
            segs, info = self.draft.transcribe(pcm, language=lang, beam_size=1, vad_filter=False, without_timestamps=True,
                                               condition_on_previous_text=False, initial_prompt=prompt)
            return "".join(s.text for s in segs).strip()

    def final(self, pcm, lang=None, prompt=None):
        return hearing.submit(self._final, pcm, lang, prompt)

    def _after(self, pcm, lang, hint, before):
        # The pieces before were queued first on this same single thread: they are done, and give the context.
        said = " ".join(f.result()[0] for f in before if f.done() and not f.exception()).strip()
        t = time.monotonic()
        out = self._final(pcm, lang, f"{hint} {said[-100:]}".strip())
        print(f"[voice] heard {len(pcm) / SR_IN:.1f}s in {time.monotonic() - t:.2f}s", flush=True)
        return out

    def final_after(self, pcm, lang, hint, before):
        """One piece of what the owner says, heard with what they said before it as context."""
        return hearing.submit(self._after, pcm, lang, hint, list(before))

    def partial(self, pcm, lang=None, prompt=None):
        return cpu.submit(self._partial, pcm, lang, prompt)


class Mouth:
    """Qwen3-TTS Base on MLX, cloning a voice in context from a recording and what it says."""

    def __init__(self, model, voices):
        self.model_id, self.voices, self.refs, self.model, self.lines = model, voices, {}, None, {}
        speaking.submit(self._load).result()

    def _load(self):
        from mlx_audio.tts.utils import load_model
        self.model = load_model(self.model_id)

    def _ref(self, name):
        if name not in self.refs:
            from mlx_audio.utils import load_audio
            audio = next(p for d in self.voices for p in (d / f"{name}.flac", d / f"{name}.wav") if p.exists())
            meta = audio.with_suffix(".json")
            text = json.loads(meta.read_text()).get("refText") if meta.exists() else None
            self.refs[name] = (load_audio(str(audio), sample_rate=SR_OUT), text or None)
        return self.refs[name]

    @staticmethod
    def cap(text):
        """The model sometimes never stops on a short line: cap it near the longest real reading (12.5 tokens/s)."""
        return min(2048, max(20, int(len(text) * 1.35) + 12))

    def _speak(self, text, lang, voice, push, stop):
        ref, ref_text = self._ref(voice)
        gen = self.model.generate(text=text, ref_audio=ref, ref_text=ref_text, lang_code=LANGS.get(lang, "spanish"),
                                  temperature=0.7, max_tokens=self.cap(text), stream=True, streaming_interval=0.25,
                                  verbose=False)
        for r in gen:
            if stop.is_set():
                break
            a = np.clip(np.array(r.audio, dtype=np.float32), -1, 1)
            push((a * 32767).astype(np.int16).tobytes())

    def line(self, text, lang, voice):
        """A whole line as one PCM buffer, made once (the greeting): the first words of a call never wait."""
        key = (text, lang, voice)
        if key not in self.lines:
            out = []
            self.speak(text, lang, voice, out.append, threading.Event()).result()
            self.lines[key] = b"".join(out)
        return self.lines[key]

    def speak(self, text, lang, voice, push, stop):
        """push(bytes) per chunk of 24 kHz PCM16 as it is made; returns a future done when the line is."""
        return speaking.submit(self._speak, text, lang, voice, push, stop)


class Speech:
    """The engine's parts, each loaded the first time it is used and kept while the engine runs."""

    def __init__(self):
        # The owner's own recordings (<home>/voices/es-AR-female.wav…) come before APX's: they never ship with it.
        own = Path(os.environ["VOICE_VOICES"]) if os.environ.get("VOICE_VOICES") else None
        self.voices = [d for d in (own, VOICES) if d and d.is_dir()]
        self.models = tier()
        self._lock = threading.Lock()
        self._vad = self._turn = self._ears = self._mouth = None
        self.last_use = time.monotonic()

    def _once(self, attr, make):
        with self._lock:
            if getattr(self, attr) is None:
                setattr(self, attr, make())
            return getattr(self, attr)

    @property
    def vad(self):
        return self._once("_vad", Vad)

    @property
    def turn(self):
        return self._once("_turn", EndOfTurn)

    @property
    def ears(self):
        return self._once("_ears", lambda: Ears(self.models["stt"], self.models["draft"]))

    @property
    def mouth(self):
        return self._once("_mouth", lambda: Mouth(self.models["tts"], self.voices))

    def loaded(self):
        return {"mouth": self._mouth is not None, "ears": self._ears is not None}

    def voice(self, name):
        """One of APX's voices ("es-AR-female"); an unknown name gets the first one of its gender, then any."""
        have = sorted({p.stem for d in self.voices for p in d.iterdir() if p.suffix in (".flac", ".wav")})
        if name in have:
            return name
        gender = name.rsplit("-", 1)[-1]
        return next((v for v in have if v.endswith(f"-{gender}")), have[0])

    def for_call(self):
        """Everything a call uses, loaded before it begins."""
        _ = self.vad, self.turn, self.ears.draft, self.mouth  # the mouth too: a call speaks first
        self.warm()

    def warm(self):
        """Keeps the loaded MLX models resident: macOS compresses an idle model, and the next line waits."""
        if self._ears is not None:
            self.ears.final(np.zeros(SR_IN, dtype=np.float32), "es").result()
        if self._mouth is not None or self._ears is None:
            self.mouth.speak("Hola.", "es", self.voice("es-AR-female"), lambda _: None, threading.Event()).result()
        self.last_use = time.monotonic()


def prefetch(report):
    """Downloads every model of this machine's tier, reporting bytes as they arrive (voice.install)."""
    from huggingface_hub import HfApi, constants, hf_hub_download
    api, files = HfApi(), []
    for repo in (tier()["tts"], tier()["stt"], tier()["draft"]):
        files += [(repo, f.rfilename, f.size or 0) for f in api.model_info(repo, files_metadata=True).siblings]
    files += [(repo, name, 0) for repo, name in SMALL]
    total, state = sum(size for *_, size in files), {"done": 0, "repo": None, "stop": False}

    def partial():  # a big file says nothing until it is done: count what reached its .incomplete file
        repo = state["repo"]
        if not repo:
            return 0
        blobs = Path(constants.HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / "blobs"
        return sum(p.stat().st_size for p in blobs.glob("*.incomplete")) if blobs.exists() else 0

    def tick():
        while not state["stop"]:
            report(min(total, state["done"] + partial()), total)
            time.sleep(1)

    threading.Thread(target=tick, daemon=True).start()
    try:
        for repo, name, size in files:
            state["repo"] = repo
            hf_hub_download(repo, name)
            state["done"] += size
    finally:
        state["stop"] = True
    report(total, total)
