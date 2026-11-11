# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "fastapi>=0.115",
#   "uvicorn[standard]>=0.32",
#   "httpx>=0.27",
#   "numpy>=1.26",
#   "onnxruntime>=1.19",
#   "huggingface_hub>=0.26",
#   "transformers>=5.0.0rc1",
#   "mlx-whisper>=0.4",
#   "mlx-audio==0.5.0",
#   "faster-whisper>=1.1",
#   "soundfile>=0.12",
# ]
# ///
"""APX's voice engine for calls (services/voice-engine.ts starts it, transport/voice-call.ts relays one call).

It hears the owner, answers with a fast voice model and speaks with a cloned voice. What needs real work it asks the
core for ([[task: …]] → an "ask" frame); the core runs the super-agent and sends the answer back as a "result" frame,
which is read to the owner as soon as nobody is talking.

Up from the core: binary 16 kHz mono PCM16, and JSON {"type": "result", n, state, text}.
Down to the core: binary 24 kHz mono PCM16, and JSON frames: heard, said, turn_end, ask (written in the call's
thread), partial, interrupted, state, ready, end (shown live).
"""
import argparse
import asyncio
import hmac
import json
import os
import re
import sys
import threading
import time
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx  # noqa: E402
import numpy as np  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from speech import FRAME, SR_IN, SR_OUT, Speech  # noqa: E402

SECRET = os.environ.get("VOICE_SECRET", "")
LLM_URL = os.environ.get("VOICE_LLM_URL", "http://127.0.0.1:11434").rstrip("/")
LLM_MODEL = os.environ.get("VOICE_LLM_MODEL", "qwen3:4b-instruct")
LLM_KIND = os.environ.get("VOICE_LLM_KIND", "ollama")
LLM_KEY = os.environ.get("VOICE_LLM_KEY", "")
VOICES = {"female": os.environ.get("VOICE_FEMALE", ""), "male": os.environ.get("VOICE_MALE", "")}
OWNER = os.environ.get("VOICE_OWNER", "")

# Turn taking, in 32 ms frames.
VAD_ON, VAD_ON_SPEAKING = 0.5, 0.8  # higher while the voice speaks: what leaks past echo cancelling is not the owner
START_FRAMES, BARGE_FRAMES = 3, 6
EARLY_STT_MS, TURN_CHECK_MS, TURN_MAX_MS = 64, 160, 900
MIN_SPEECH_MS, PARTIAL_EVERY_S = 250, 0.7
FRAME_MS = FRAME / SR_IN * 1000
QUIET_BEFORE_NEWS_S = 0.8
TOLD_SENTENCES = 3

SENTENCE_END = re.compile(r"(?<=[.!?…])[\"')\]]?\s+")
TASK = re.compile(r"\[\[\s*(?:task|tarea)\s*:\s*(.+?)\s*(?:\]\]|$)", re.I | re.S)
SKIP = re.compile(r"\[\[\s*skip\s*\]\]", re.I)
NOISE = re.compile(r"(subt[ií]tulos|amara\.org|gracias por ver|thanks for watching)", re.I)
BYE_HEARD = re.compile(r"\b(chau|chao|adi[oó]s|hasta luego|nos vemos|bye|goodbye|see you)\b", re.I)
MARKUP = re.compile(r"[*_#`]+")

PROMPT = """You are {name}, {owner}'s personal assistant in APX, talking with {owner} on a voice call.

## How you talk

- This is speech, not chat. Answer in one to three short sentences. No lists, no markdown, no emojis, no parentheses, no URLs.
- Speak only the call language given in the note at the end of each turn. Never repeat or translate what you said into another language.
- In Spanish use Argentine Spanish with voseo ("querés", "decime", "fijate").
- The note says whether your voice is male or female: use that grammatical gender for yourself.
- {owner}'s words reach you through speech-to-text. When something sounds misheard and the meaning is unclear, ask in a few words.
- Be warm and direct. Do not end every answer with a question.

## Work in the background

You cannot look anything up or do anything yourself during the call. Behind you, {name} works with all of {owner}'s projects, agents, memory, mail, calendar, web and tools. A task you start runs there while you keep talking.

- When {owner} asks for something that needs real information or an action outside this conversation (a project, a mail, the calendar, the web, the news, a file, sending or changing anything, anything you would otherwise have to guess), never make the answer up. Say one short sentence that you are on it, like "Dale, dejame que lo veo." and end that same reply with the tag [[task: the full request, clear and self-contained, in {owner}'s language]]. The tag is never read aloud.
- One tag per request. No task for small talk, for what you already know from this call, or for a task already running.
- The note lists the tasks running behind you. When asked, say what is still running and for how long. Keep talking about anything else meanwhile.
- When a task finishes, its answer is read to {owner} right away and a note brings you the full answer: use it for follow-up questions, do not repeat it.
- Never say a task is done, and never describe or guess what it will find, unless a note brought its answer.
- When {owner} only acknowledges or says they will wait ("dale", "ok", "genial", "te espero") and you have nothing new, answer exactly [[skip]]: you stay silent until there is news.

## Ending

When {owner} says goodbye, answer with one short goodbye.
"""
GREETING = {"es": "Hola{owner}, ¿en qué te ayudo?", "en": "Hi{owner}, what can I do for you?"}
STT_HINT = {"es": "Hola {name}, ¿me ayudás con algo? APX.", "en": "Hi {name}, can you help me with something? APX."}
HOLD_ON = {"es": "Dame un segundo.", "en": "Give me a second."}
HOLD_ON_S = 4  # the voice model is this slow to start: say so instead of going quiet
FAILED = {"es": "No pude terminar lo que me pediste.", "en": "I couldn't finish what you asked."}

speech: Speech | None = None
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
http = httpx.AsyncClient(timeout=httpx.Timeout(120, connect=5))
llm_state = {"system": None, "used": 0.0}


def allowed(secret):
    return bool(SECRET) and hmac.compare_digest(secret or "", SECRET)


# ---- the voice model ----

async def llm_stream(messages):
    if LLM_KIND == "openai":
        body = {"model": LLM_MODEL, "messages": messages, "stream": True, "temperature": 0.6, "max_tokens": 220}
        headers = {"authorization": f"Bearer {LLM_KEY}"} if LLM_KEY else {}
        async with http.stream("POST", f"{LLM_URL}/chat/completions", json=body, headers=headers) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    for ch in json.loads(line[6:]).get("choices", []):
                        yield (ch.get("delta") or {}).get("content") or ""
        return
    # Ollama's own API: its OpenAI-compatible one ignores the context size, and the default cuts the prompt.
    body = {"model": LLM_MODEL, "messages": messages, "stream": True, "think": False, "keep_alive": "30m",
            "options": {"num_ctx": 8192, "temperature": 0.6, "num_predict": 220}}
    async with http.stream("POST", f"{LLM_URL}/api/chat", json=body) as r:
        r.raise_for_status()
        async for line in r.aiter_lines():
            if line.strip():
                d = json.loads(line)
                if "error" in d:
                    raise RuntimeError(d["error"])
                yield (d.get("message") or {}).get("content") or ""


async def sentences(messages):
    """The reply sentence by sentence as it streams; a sentence holding an unclosed tag waits for its end."""
    buf = ""
    async for piece in llm_stream(messages):
        buf += piece
        while True:
            m = SENTENCE_END.search(buf)
            if not m or ("[[" in buf[:m.end()] and "]]" not in buf[:m.end()]):
                break
            out, buf = buf[:m.end()].strip(), buf[m.end():]
            if out:
                yield out
    if buf.strip():
        yield buf.strip()


def clean(text):
    return re.sub(r"\s+", " ", MARKUP.sub("", text)).strip()


async def keep_llm_warm():
    """A shared model server drops a prompt it has not seen in a while; reading it again costs seconds."""
    while True:
        await asyncio.sleep(10)
        if llm_state["system"] and time.monotonic() - llm_state["used"] > 45:
            llm_state["used"] = time.monotonic()
            try:
                async for _ in llm_stream([llm_state["system"], {"role": "user", "content": "Hola."}]):
                    break
            except Exception as e:
                print(f"[voice] llm keep-warm: {e}", flush=True)


async def keep_speech_warm():
    while True:
        await asyncio.sleep(10)
        if speech and time.monotonic() - speech.last_use > 30:
            await asyncio.to_thread(speech.warm)


async def follow_core():
    """The core that started this engine is gone (it crashed or was killed): leave too, freeing the GPU."""
    pid = int(os.environ.get("VOICE_PARENT_PID") or 0)
    while pid:
        await asyncio.sleep(2)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            print("[voice] the core is gone, stopping", flush=True)
            os._exit(0)
        except PermissionError:
            pass


@app.on_event("startup")
async def startup():
    global speech
    asyncio.create_task(follow_core())
    speech = await asyncio.to_thread(Speech)
    for lang, line in GREETING.items():
        for v in VOICES.values():
            if v:
                await asyncio.to_thread(speech.mouth.line, line.format(owner=f" {OWNER}" if OWNER else ""), lang,
                                        speech.voice(v))
    asyncio.create_task(keep_llm_warm())
    asyncio.create_task(keep_speech_warm())
    print("[voice] ready", flush=True)


@app.get("/health")
async def health(request: Request):
    if not allowed(request.headers.get("x-voice-secret")):
        return JSONResponse({"ok": False}, status_code=403)
    return {"ok": speech is not None}


# ---- one call ----

class Call:
    def __init__(self, ws, voice, lang, owner, name):
        self.ws, self.lang, self.owner, self.name = ws, lang if lang in ("es", "en") else "es", owner, name or "APX"
        self.hint = STT_HINT[self.lang].format(name=self.name)
        self.gender = "male" if voice == "male" else "female"
        self.voice = speech.voice(VOICES[self.gender])
        self.vad = speech.vad.stream()
        self.system = {"role": "system", "content": PROMPT.format(name=self.name, owner=owner or "the owner")}
        self.history, self.tasks, self.news = [], {}, deque()
        self.pending = np.zeros(0, dtype=np.float32)
        self.preroll, self.utt = deque(maxlen=8), []
        self.in_speech, self.run, self.silence, self.speech_frames = False, 0, 0, 0
        self.stt, self.checked, self.barged, self.partial_at, self.partial_task = None, False, False, 0.0, None
        self.reply_task, self.stop = None, threading.Event()
        self.playing_until, self.last_voice = 0.0, time.monotonic()
        self.n, self.unheard, self.carry = 0, [], ""

    async def send(self, frame):
        await self.ws.send_text(json.dumps(frame, ensure_ascii=False))

    def speaking(self):
        """Audio of the voice still playing at the owner's end (what an interruption cuts)."""
        return time.monotonic() < self.playing_until

    def busy(self):
        """Answering or speaking: news waits for it."""
        return (self.reply_task and not self.reply_task.done()) or self.speaking()

    async def say(self, text):
        """Speaks one line: its audio goes down as it is made, its words once it is done."""
        loop, q = asyncio.get_running_loop(), asyncio.Queue()
        self.stop = threading.Event()
        fut = speech.mouth.speak(text, self.lang, self.voice, lambda b: loop.call_soon_threadsafe(q.put_nowait, b),
                                 self.stop)
        fut.add_done_callback(lambda _: loop.call_soon_threadsafe(q.put_nowait, None))
        try:
            while (b := await q.get()) is not None:
                now = time.monotonic()
                self.playing_until = max(now, self.playing_until) + len(b) / 2 / SR_OUT
                await self.ws.send_bytes(b)
        finally:
            self.stop.set()
            speech.last_use = time.monotonic()
        await self.send({"type": "said", "text": text})

    def note(self):
        running = [f'- task {n} "{t}": running for {int(time.monotonic() - s)} s, no answer yet (never guess it)'
                   for n, (t, s) in self.tasks.items()]
        tasks = "Background tasks:\n" + "\n".join(running) if running else "No background tasks."
        tongue = "Spanish, Argentine with voseo" if self.lang == "es" else "English"
        return f"(Note. Call language: {tongue}. Your voice: {self.gender}. {tasks})"

    async def warm(self):
        """Reads the prompt while the greeting plays: a model that has not seen it takes seconds on the first answer."""
        llm_state.update(system=self.system, used=time.monotonic())
        try:
            async for _ in llm_stream([self.system, {"role": "user", "content": "Hola."}]):
                break
        except Exception as e:
            print(f"[voice] llm warm: {e!r}", flush=True)

    async def greet(self):
        line = GREETING[self.lang].format(owner=f" {self.owner}" if self.owner else "")
        self.history.append({"role": "assistant", "content": line})
        await self.send({"type": "state", "state": "speaking"})
        pcm = await asyncio.to_thread(speech.mouth.line, line, self.lang, self.voice)
        self.playing_until = time.monotonic() + len(pcm) / 2 / SR_OUT
        for i in range(0, len(pcm), SR_OUT):  # half-second chunks: an interruption drops what is not played yet
            await self.ws.send_bytes(pcm[i:i + SR_OUT])
        await self.send({"type": "said", "text": line})
        await self.send({"type": "turn_end"})

    async def reply(self, text, heard):
        self.history.append({"role": "user", "content": f"{text}\n{self.note()}"})
        messages = [self.system, *self.history]
        llm_state.update(system=self.system, used=time.monotonic())
        await self.send({"type": "state", "state": "thinking"})
        spoken, skipped = [], False
        self.carry = ""
        holding = {"speaking": False}
        filler = asyncio.create_task(self.hold_on(holding))

        async def settle_filler():  # a line already being said ends; one not begun never is
            if not filler.done():
                await filler if holding["speaking"] else filler.cancel()

        try:
            async for raw in sentences(messages):
                if SKIP.search(raw):
                    skipped, raw = True, SKIP.sub("", raw)
                for m in TASK.finditer(raw):
                    self.n += 1
                    self.tasks[self.n] = (m.group(1).strip(), time.monotonic())
                    await self.send({"type": "ask", "n": self.n, "task": m.group(1).strip(), "heard": heard})
                line = clean(TASK.sub("", raw))
                if not line:
                    continue
                await settle_filler()
                if not spoken:
                    await self.send({"type": "state", "state": "speaking"})
                await self.say(line)
                spoken.append(line)
        except asyncio.CancelledError:
            filler.cancel()
            if not spoken:  # the owner went on before a word was said: their words join the next turn
                self.history.pop()
                self.carry = text
                raise
            self.history.append({"role": "assistant", "content": " ".join(spoken) + " …"})
            raise
        else:
            await settle_filler()
            said = " ".join(spoken)
            self.history.append({"role": "assistant", "content": said or ("[[skip]]" if skipped else "…")})
        finally:
            await self.send({"type": "turn_end"})
        if BYE_HEARD.search(heard) and len(heard.split()) <= 8 and spoken:
            await asyncio.sleep(max(0.0, self.playing_until - time.monotonic()) + 0.4)
            await self.send({"type": "end", "reason": "goodbye"})

    async def hold_on(self, holding):
        await asyncio.sleep(HOLD_ON_S)
        holding["speaking"] = True
        await self.send({"type": "state", "state": "speaking"})
        await self.say(HOLD_ON[self.lang])

    async def tell(self, n, state, text):
        """A task's answer, read as it came: no model in between, so nothing waits and nothing is made up."""
        task = self.tasks.pop(n, ("", 0))[0]
        answer = clean(text)
        lines = [s for s in SENTENCE_END.split(answer) if s.strip()][:TOLD_SENTENCES] if state == "done" and answer \
            else [FAILED[self.lang]]
        spoken = []
        try:
            await self.send({"type": "state", "state": "speaking"})
            for line in lines:
                await self.say(line)
                spoken.append(line)
        finally:
            self.history.append({"role": "user", "content": f'(Note: task {n} "{task}" finished: {state}. '
                                                            f"Full answer: {answer[:2000] or 'none'})"})
            self.history.append({"role": "assistant", "content": " ".join(spoken) or "…"})
            await self.send({"type": "turn_end"})

    def maybe_tell(self):
        if not self.news or self.in_speech or self.busy() or time.monotonic() - self.last_voice < QUIET_BEFORE_NEWS_S:
            return
        n, state, text = self.news.popleft()
        self.reply_task = asyncio.create_task(self.tell(n, state, text))

    def barge_in(self):
        self.barged = True
        self.stop.set()
        if self.reply_task and not self.reply_task.done():
            self.reply_task.cancel()
        self.playing_until = time.monotonic()

    async def feed(self, data):
        a = np.frombuffer(data[: len(data) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768
        self.pending = np.concatenate([self.pending, a])
        while len(self.pending) >= FRAME:
            frame, self.pending = self.pending[:FRAME], self.pending[FRAME:]
            await self.frame(frame)

    async def frame(self, frame):
        p = self.vad.prob(frame)
        talking = self.speaking()
        voiced = p >= (VAD_ON_SPEAKING if talking else VAD_ON)
        now = time.monotonic()
        if not self.in_speech:
            self.preroll.append(frame)
            self.run = self.run + 1 if voiced else 0
            if self.run >= START_FRAMES:
                self.in_speech, self.utt, self.silence = True, list(self.preroll), 0
                self.speech_frames, self.checked, self.barged, self.stt, self.partial_at = self.run, False, False, None, 0
                self.last_voice = now
            return
        self.utt.append(frame)
        if voiced:
            self.speech_frames += 1
            self.run = self.run + 1 if self.silence == 0 else 1
            if self.silence:
                self.silence, self.checked, self.stt = 0, False, None
            self.last_voice = now
            if talking and not self.barged and self.run >= BARGE_FRAMES:
                self.barge_in()
                await self.send({"type": "interrupted"})
            self.maybe_partial(talking)
            return
        self.silence += 1
        quiet = self.silence * FRAME_MS
        if quiet >= EARLY_STT_MS and self.stt is None:
            self.stt = speech.ears.final(np.concatenate(self.utt), self.lang, self.hint)
        if quiet >= TURN_CHECK_MS and not self.checked:
            self.checked = True
            p_end = await asyncio.to_thread(speech.turn.prob, np.concatenate(self.utt))
            if p_end >= 0.5:
                return await self.commit()
        if quiet >= TURN_MAX_MS:
            await self.commit()

    def maybe_partial(self, talking):
        if (talking and not self.barged) or (self.partial_task and not self.partial_task.done()):
            return
        heard_s = len(self.utt) * FRAME / SR_IN
        if heard_s - self.partial_at < PARTIAL_EVERY_S:
            return
        self.partial_at = heard_s
        self.partial_task = asyncio.create_task(self.partial(np.concatenate(self.utt)))

    async def partial(self, audio):
        try:
            text = await asyncio.wrap_future(speech.ears.partial(audio, self.lang, self.hint))
        except Exception:
            return
        if text and self.in_speech and not NOISE.search(text):
            await self.send({"type": "partial", "text": text})

    async def commit(self):
        stt, barged, speech_ms = self.stt, self.barged, self.speech_frames * FRAME_MS
        audio = np.concatenate(self.utt)
        self.in_speech, self.utt, self.run, self.stt = False, [], 0, None
        self.preroll.clear()
        if speech_ms < MIN_SPEECH_MS or (self.speaking() and not barged):
            await self.send({"type": "partial", "text": ""})
            return
        stt = stt or speech.ears.final(audio, self.lang, self.hint)
        # The owner went on before their last words were even heard: one request, not two (the first would be lost).
        self.unheard = [*self.unheard, stt] if self.reply_task and not self.reply_task.done() else [stt]
        if self.reply_task and not self.reply_task.done():
            self.reply_task.cancel()
        self.reply_task = asyncio.create_task(self.answer(self.unheard))

    async def answer(self, stts):
        texts = []
        for f in stts:
            try:  # shielded: a newer turn takes over these same transcriptions
                texts.append((await asyncio.shield(asyncio.wrap_future(f)))[0].strip())
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[voice] stt: {e!r}", flush=True)
        self.unheard = []
        new = " ".join(t for t in texts if t)
        await self.send({"type": "partial", "text": ""})
        if not new or NOISE.search(new):
            await self.send({"type": "state", "state": "listening"})
            return
        await self.send({"type": "heard", "text": new})  # the chat already shows what was carried
        text, self.carry = " ".join(t for t in (self.carry, new) if t), ""
        try:
            await self.reply(text, text)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[voice] reply: {e!r}", flush=True)
            await self.say(FAILED[self.lang])
        await self.send({"type": "state", "state": "listening"})

    async def watch(self):
        while True:
            await asyncio.sleep(0.2)
            self.maybe_tell()


@app.websocket("/call")
async def call(ws: WebSocket):
    if not allowed(ws.headers.get("x-voice-secret")) or speech is None:
        await ws.close(code=1008)
        return
    await ws.accept()
    q = ws.query_params
    c = Call(ws, q.get("voice", "female"), q.get("lang", "es"), q.get("owner", ""), q.get("agent", ""))
    await c.send({"type": "preparing"})
    try:  # the first answer would wait while the model reads its prompt: read it before the call begins
        await asyncio.wait_for(c.warm(), 90)
    except asyncio.TimeoutError:
        print("[voice] the voice model did not answer while preparing", flush=True)
    await c.send({"type": "ready"})
    watcher = asyncio.create_task(c.watch())
    c.reply_task = asyncio.create_task(c.greet())
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                await c.feed(msg["bytes"])
            elif msg.get("text"):
                f = json.loads(msg["text"])
                if f.get("type") == "result":
                    c.news.append((int(f["n"]), f.get("state", "done"), f.get("text", "")))
    except WebSocketDisconnect:
        pass
    finally:
        watcher.cancel()
        c.barge_in()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    a = ap.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning", ws_max_size=1 << 20)
