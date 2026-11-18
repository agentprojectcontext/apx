"""Call preparation estimates, shared by local and configured-service calls."""
import asyncio
import json
import os
import time

LOADS = os.path.join(os.environ.get("VOICE_STATE") or ".", f"load-{os.environ.get('VOICE_TIER') or 'light'}.json")
FIRST_LOAD_S = {"vad": 1, "turn": 3, "draft": 5, "mouth": 10, "warm": 10, "greeting": 2}


def load_history():
    try:
        with open(LOADS) as f:
            return {k: [float(x) for x in v][-3:] for k, v in json.load(f).items() if isinstance(v, list)}
    except (OSError, ValueError, AttributeError, TypeError):
        return {}


async def load_for_call(speech, send, greeting, started_in):
    history = load_history()
    before = {**FIRST_LOAD_S, **{k: sorted(v)[len(v) // 2] for k, v in history.items() if v}}
    audio = []
    steps = [*speech.call_parts(), ("greeting", lambda: False, lambda: audio.extend(greeting()))]
    cold = {name for name, loaded, _ in steps if not loaded()}
    models_cold = cold - {"warm", "greeting"}
    guess = {name: before.get(name, 1) if name in cold and (name != "warm" or models_cold) else 0.5
             for name, _, _ in steps}
    took = {}
    for i, (name, _, load) in enumerate(steps):
        left, done = sum(guess[n] for n, _, _ in steps[i:]), sum(took.values())
        await send({"type": "preparing", "progress": round(done / (done + left), 3), "left_s": round(left)})
        t = time.monotonic()
        await asyncio.to_thread(load)
        took[name] = time.monotonic() - t
    if len(models_cold) == len(steps) - 2:
        if started_in is not None:
            took["start"] = started_in
        try:
            with open(LOADS, "w") as f:
                json.dump({k: [*history.get(k, []), round(v, 1)][-3:] for k, v in took.items()}, f)
        except OSError:
            pass
    return took, audio
