# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "fastapi>=0.115",
#   "uvicorn[standard]>=0.32",
#   "numpy>=1.26",
#   "onnxruntime>=1.19",
#   "huggingface_hub>=0.26",
#   "transformers>=5.0.0rc1",
# ]
# ///
"""The same call engine with CPU turn taking and speech services owned by the core."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["VOICE_SERVICES"] = "1"

import uvicorn  # noqa: E402
from engine import app  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", ws_max_size=8 * 1024 * 1024)
