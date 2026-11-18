"""The private call bridge stays attached to its originating asynchronous context."""
import asyncio
import threading
import unittest
from unittest.mock import Mock, patch


class LocalSpeech:
    @property
    def mouth(self):
        return self._mouth


with patch.dict("sys.modules", {"numpy": Mock(), "speech": Mock(Speech=LocalSpeech)}):
    from remote_speech import Speech


class Socket:
    def __init__(self):
        self.frames = []
        self.bridge = None

    async def send_json(self, frame):
        self.frames.append(frame)
        if frame.get("type") == "service":
            self.bridge.receive({"id": frame["id"], "error": True})


class CallIsolation(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_preparation_cannot_use_the_next_call(self):
        speech, first_socket, second_socket = Speech(), Socket(), Socket()
        first = speech.bind(first_socket)
        first_socket.bridge = first
        entered, resume = threading.Event(), threading.Event()

        def greeting():
            entered.set()
            if not resume.wait(10):
                raise RuntimeError("test greeting was not released")
            return speech.mouth.speak("Hello", "en", "voice", lambda _: None, threading.Event()).result()

        preparation = asyncio.create_task(asyncio.to_thread(greeting))
        try:
            await asyncio.wait_for(asyncio.to_thread(entered.wait), 10)
            first.close()
            second = speech.bind(second_socket)
            second_socket.bridge = second
            resume.set()
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                await asyncio.wait_for(preparation, 10)
            self.assertIs(speech.bridge, second)
            self.assertEqual(second_socket.frames, [])
            self.assertEqual(first_socket.frames, [])
            second.close()
        finally:
            resume.set()
            await asyncio.gather(preparation, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()
