---
name: apx-image
scope: optional
description: Generate images from a text prompt with `apx image`, routed to a local, LAN, or cloud diffusion server. Load when asked to draw, render, illustrate, or make a picture, logo sketch, thumbnail, or cover; to pick between image engines; to set image size, steps, guidance, seed, or a negative prompt; or when an image engine is unreachable or ignoring options.
---

# apx-image

`apx image` turns a prompt into a file. It is a thin CLI over the daemon's `POST /api/images/generate`, which routes to whichever engine is configured and reachable — so the same command works against a diffusion server on this machine, a box on the network, or a cloud key, without the caller knowing which.

## Usage

```bash
apx image "a green origami fox on a white background"
apx image "portrait of a fox" --size 768x512 --steps 8 --cfg 1.0 --out fox.png
apx image "a logo sketch" --provider a1111 --seed 123 --json
apx image "cover art" --negative "text, watermark" --count 2 --open
apx image providers                      # what is configured and reachable
apx image capabilities --provider sdcpp  # models, samplers, schedulers
```

Without `--out`, the file lands in `~/.apx/images/<date>/` and the path is printed on stdout. **Nothing is written into a project checkout unless `--out` says so.**

## Engines

| id | Dialect | Notes |
|---|---|---|
| `a1111` | `POST /sdapi/v1/txt2img`, synchronous | The universal one: AUTOMATIC1111, Forge, SD.Next, Draw Things on macOS, stable-diffusion.cpp. Carries every sampling knob. |
| `sdcpp` | `POST /sdcpp/v1/img_gen` + job polling | stable-diffusion.cpp's native queue. The socket closes immediately and the job is polled, so a queued render never looks like a hung request. One checkpoint per server. |
| `openai` | `POST /v1/images/generations` | Cloud (`gpt-image-1` / `dall-e-3`), or any OpenAI-compatible server when `base_url` is set. |
| `mock` | none | Offline test engine, always last and always available. |

Add any number of extra endpoints under `images.custom.<slug>`, each naming the dialect it speaks in `kind`. They surface as `custom:<slug>`.

## Routing

Engines are tried in `images.order` and the first reachable one draws — the same chain/single model as TTS. Set `images.mode` to `single` plus `images.provider` to pin one. `--provider` overrides the routing for one call. A configured but unreachable server is skipped rather than failing the call.

```bash
apx config set --global images.a1111.base_url http://127.0.0.1:7860
apx config set --global images.a1111.defaults '{"steps":8,"cfg_scale":1}'
```

Settings live in `~/.apx/config.json` under `images.*`, and the same settings have a screen at **Settings → Images** in the web panel.

## Options resolve in four layers

`images.defaults` → `images.<engine>.defaults` → the call. Later wins. Steps and guidance belong to the **engine**, not to the prompt: a turbo checkpoint wants about 8 steps at cfg 1, a standard one 20 at cfg 7, and putting that in the engine's block means no caller has to remember it.

## Not every engine honors every option

The OpenAI dialect has no steps, guidance, sampler, scheduler, seed or negative prompt. stable-diffusion.cpp hosts one checkpoint and cannot switch models. Whatever an engine cannot honor is **reported** after the run (`ignored` in `--json`) instead of being silently dropped — so a picture that came out wrong can be traced to the dialect rather than the prompt.

## Don't

- Don't call a diffusion server directly with `curl` when an engine is configured — routing, defaults, the seed report and the ignored-options report all live behind `apx image`, and a raw call has none of them.
- Don't reach for Ollama: it serves language and vision models and cannot generate images at all. On macOS point the `a1111` engine at Draw Things' HTTP API, or any local A1111-compatible server, instead.
- Don't set steps or guidance in `images.defaults` when several engines are configured — they belong to `images.<engine>.defaults`, because the right value depends on the checkpoint that server loaded.
- Don't ask the `openai` engine for a negative prompt or a fixed seed and assume it took: check `ignored`.
- Don't write generated images into a repository by default — leave them in `~/.apx/images/` and pass `--out` only when a file is genuinely wanted on disk somewhere.
