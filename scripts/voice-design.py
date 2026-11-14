# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mlx-audio==0.5.0", "soundfile>=0.12", "transformers>=5.0.0rc1"]
# ///
"""Makes APX's own voices (apps/core/src/voice/voices) with Qwen3-TTS VoiceDesign (Apache-2.0): a voice described in
words reads a sample text, and the voice engine clones from that recording. No real person's voice is used.

    uv run --script scripts/voice-design.py <out-dir> [voice ...]   # Apple silicon (MLX)

Each voice gets TAKES takes (<id>-<n>.wav + .json); the chosen one is copied as <id>.wav / <id>.json.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model

TAKES = 2

AR = ("Hola, ¿cómo andás? Mirá, te cuento: ayer fui al centro a hacer unos trámites y la verdad que fue un lío bárbaro. "
      "Pero bueno, después me tomé un café con medialunas, charlé un rato largo con un amigo y se me pasó todo. "
      "¿Y vos qué hiciste el fin de semana? Dale, contame, que quiero saber.")
ES = ("Hola, ¿qué tal estás? Te cuento: ayer fui al centro a hacer unos trámites y la verdad es que fue un lío tremendo. "
      "Pero bueno, después me tomé un café con un amigo, estuvimos conversando un buen rato y se me pasó todo. "
      "¿Y tú qué hiciste el fin de semana? Cuéntame, que quiero saber.")
EN = ("Hey, how's it going? So, yesterday I went downtown to run a few errands, and honestly it was a total mess. "
      "But after that I grabbed a coffee with a friend, we talked for a good while, and it all went away. "
      "What did you do this weekend? Come on, tell me, I want to know.")

WOMAN = "A woman in her early thirties"
MAN = "A man in his mid thirties"
WARM_F = "Warm, friendly and clear, conversational pace, close to the microphone, studio quality."
WARM_M = "Warm, calm and confident, conversational pace, close to the microphone, studio quality."
PORTENO = (" from Buenos Aires, Argentina, speaking rioplatense Spanish with a natural porteño accent: the 'll' and 'y'"
           " sound like 'sh', voseo, a relaxed melodic Italian-like intonation. ")
NEUTRAL = " speaking neutral Latin American Spanish, like a professional dubbing voice, with no regional accent. "
AMERICAN = " from the United States with a General American accent. "

VOICES = {
    "es-AR-female": ("spanish", AR, WOMAN + PORTENO + WARM_F),
    "es-AR-male": ("spanish", AR, MAN + PORTENO + WARM_M),
    "es-female": ("spanish", ES, WOMAN + NEUTRAL + WARM_F),
    "es-male": ("spanish", ES, MAN + NEUTRAL + WARM_M),
    "en-US-female": ("english", EN, WOMAN + AMERICAN + WARM_F),
    "en-US-male": ("english", EN, MAN + AMERICAN + WARM_M),
}


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[2:])
    model = load_model("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
    for name, (lang, text, instruct) in VOICES.items():
        if only and name not in only:
            continue
        for take in range(1, TAKES + 1):
            t = time.time()
            audio = np.concatenate([np.array(r.audio, dtype=np.float32) for r in
                                    model.generate(text=text, instruct=instruct, lang_code=lang, temperature=0.8,
                                                   max_tokens=900)])
            sf.write(out / f"{name}-{take}.wav", audio, model.sample_rate, subtype="PCM_16")
            (out / f"{name}-{take}.json").write_text(
                json.dumps({"refText": text, "instruct": instruct}, ensure_ascii=False, indent=1))
            print(f"{name}-{take}: {len(audio) / model.sample_rate:.1f}s in {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    main()
