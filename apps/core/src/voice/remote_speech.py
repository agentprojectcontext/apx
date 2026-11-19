"""Speech-service requests cross the existing private call socket, never a public endpoint."""
import asyncio
import base64
from contextvars import ContextVar
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError

import numpy as np
from speech import Speech as LocalSpeech

work = ThreadPoolExecutor(max_workers=2, thread_name_prefix="speech-services")


class Bridge:
    def __init__(self, ws):
        self.ws, self.loop = ws, asyncio.get_running_loop()
        self.pending, self.serial, self.closed = {}, 0, False

    async def request(self, operation, payload):
        if self.closed or len(self.pending) >= 4:
            raise RuntimeError("speech service unavailable")
        self.serial += 1
        n = self.serial
        future = self.loop.create_future()
        self.pending[n] = future
        try:
            await self.ws.send_json({"type": "service", "id": n, "operation": operation, **payload})
            return await asyncio.wait_for(future, timeout=90)
        finally:
            self.pending.pop(n, None)
            if not self.closed:
                await self.ws.send_json({"type": "service_cancel", "id": n})

    def ask(self, operation, payload, stop=None):
        future = asyncio.run_coroutine_threadsafe(self.request(operation, payload), self.loop)
        until = time.monotonic() + 95
        try:
            while time.monotonic() < until:
                if stop and stop.is_set():
                    raise RuntimeError("speech interrupted")
                try:
                    return future.result(timeout=0.1)
                except TimeoutError:
                    continue
            raise TimeoutError("speech service timed out")
        finally:
            if not future.done():
                future.cancel()

    def receive(self, frame):
        future = self.pending.get(frame.get("id"))
        if future and not future.done():
            if frame.get("error"):
                future.set_exception(RuntimeError("speech service failed"))
            else:
                future.set_result(frame)

    def close(self):
        self.closed = True
        for future in list(self.pending.values()):
            future.cancel()


class Ears:
    def __init__(self, speech):
        self.speech = speech

    def final(self, pcm, lang=None, prompt=None):
        bridge = self.speech.bridge
        def run():
            audio = (np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()
            result = bridge.ask("transcribe", {"audio": base64.b64encode(audio).decode("ascii")})
            return result.get("text", ""), lang
        return work.submit(run)

    def final_after(self, pcm, lang, hint, before):
        return self.final(pcm, lang, hint)

    def partial(self, pcm, lang=None, prompt=None):
        result = Future()
        result.set_result("")
        return result


class Mouth:
    def __init__(self, speech):
        self.speech = speech

    def speak(self, text, lang, voice, emit, stop):
        bridge = self.speech.bridge
        def run():
            result = bridge.ask("speak", {"text": text}, stop)
            pcm = base64.b64decode(result.get("audio", ""), validate=True)
            if not pcm or len(pcm) % 2:
                raise RuntimeError("no playable speech")
            for start in range(0, len(pcm), 4800):
                if stop.is_set():
                    break
                emit(pcm[start:start + 4800])
        return work.submit(run)


class Speech(LocalSpeech):
    def __init__(self):
        super().__init__()
        self._bridge = ContextVar("call_bridge", default=None)
        self._ears, self._mouth = Ears(self), Mouth(self)

    @property
    def bridge(self):
        return self._bridge.get()

    def bind(self, ws):
        bridge = Bridge(ws)
        self._bridge.set(bridge)
        return bridge

    def voice(self, name):
        return name

    def call_parts(self):
        return [("vad", lambda: self._vad is not None, lambda: self.vad),
                ("turn", lambda: self._turn is not None, lambda: self.turn)]

    def warm(self):
        self.last_use = time.monotonic()
