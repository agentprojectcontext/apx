// apx image — text-to-image from the command line.
//
//   apx image "<prompt>"                       generate with the routed engine
//   apx image "<prompt>" --out fox.png         write it where you say
//   apx image "<prompt>" --size 768x512 --steps 8 --cfg 1.0
//   apx image "<prompt>" --provider a1111      force one engine
//   apx image "<prompt>" --init photo.png      img2img: start from that picture
//   apx image "<prompt>" --control pose.png    ControlNet: keep its structure
//   apx image "<prompt>" --init p.png --mask m.png   inpaint just the white part
//   apx image providers                        which engines are reachable
//   apx image capabilities [--provider <id>]   models/samplers a server offers
//
// Two reference-image flags, not one, because they are two operations against
// two routes: --init hands the sampler a canvas to repaint (how far it may
// stray is --denoise), --control hands it a structure to build a fresh picture
// around (how hard to enforce it is --control-strength). --img-ref is accepted
// as a friendlier spelling of --init, which is the one people reach for.
// The file is read here and sent as base64, so the daemon may be on another
// machine; express caps a body at 2 MB, which SIZE_LIMIT keeps us under.
//
// A thin client over the daemon's POST /api/images/generate — the same routing
// the web panel and any agent surface use, so a picture made here is made the
// same way everywhere. The daemon writes into ~/.apx/images/<date>/; --out
// copies the result to a path of your choosing. Nothing is ever written into a
// project checkout unless --out asks for it.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { http } from "../http.js";

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const NO_COLOR = !!process.env.NO_COLOR;
const paint = (code) => (s) => (NO_COLOR ? s : `${code}${s}${c.reset}`);
const err = paint(c.red);
const dim = paint(c.dim);
const bold = paint(c.bold);
const ok = paint(c.green);
const warn = paint(c.yellow);
const cy = paint(c.cyan);

// Reserved first positionals. A prompt that is literally one of these words
// needs --prompt to disambiguate; anything else is read as the prompt.
const SUBCOMMANDS = new Set(["providers", "capabilities"]);

const USAGE = [
  "Usage: apx image \"<prompt>\" [--out <file>] [--provider <id>] [--size 768x512]",
  "                  [--steps N] [--cfg N] [--seed N] [--negative \"...\"]",
  "                  [--count N] [--model <id>] [--format png|jpeg|webp] [--json] [--open]",
  "                  [--init <img> [--denoise 0.45] [--mask <img> [--mask-blur N]]]",
  "                  [--control <img> [--control-strength 0.8]]",
  "       apx image providers",
  "       apx image capabilities [--provider <id>]",
].join("\n");

// Express parses request bodies up to 2 MB (host/daemon/api.js). Base64 costs
// a third on top, so refuse a little under that with an actionable message
// rather than letting the daemon answer an opaque 413.
const SIZE_LIMIT = 1_400_000;

/**
 * Read a reference image and return bare base64.
 *
 * Failing loudly here matters: a mistyped path that fell through would render
 * a perfectly good picture that simply ignored the reference, and nothing in
 * the output would say why.
 */
function readImageFlag(value, flagName) {
  const file = str(value);
  if (!file) throw new Error(`${flagName} needs a file path`);
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${flagName}: no such file — ${resolved}`);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) throw new Error(`${flagName}: that is a directory — ${resolved}`);
  if (stat.size > SIZE_LIMIT) {
    throw new Error(
      `${flagName}: ${formatBytes(stat.size)} is too big (limit ${formatBytes(SIZE_LIMIT)}).\n` +
      `  Shrink it first, e.g.  sips -Z 768 "${resolved}" --out /tmp/ref.png`
    );
  }
  return fs.readFileSync(resolved).toString("base64");
}

function num(v) {
  if (v === undefined || v === true) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Flags → the body POST /images/generate expects. Absent stays absent. */
function requestFrom(flags) {
  const body = {};
  const put = (key, value) => { if (value !== undefined) body[key] = value; };
  put("provider", str(flags.provider));
  put("size", str(flags.size));
  put("width", num(flags.width));
  put("height", num(flags.height));
  put("steps", num(flags.steps));
  put("cfg_scale", num(flags.cfg ?? flags["cfg-scale"] ?? flags.cfg_scale));
  put("seed", num(flags.seed));
  put("count", num(flags.count ?? flags.n));
  put("sampler", str(flags.sampler));
  put("scheduler", str(flags.scheduler));
  put("negative_prompt", str(flags.negative ?? flags["negative-prompt"]));
  put("model", str(flags.model));
  put("format", str(flags.format));

  // --img-ref is the same thing as --init; refuse to guess if both are given
  // with different files, since silently dropping one changes the picture.
  const initFlag = flags.init ?? flags["img-ref"] ?? flags.img_ref;
  const controlFlag = flags.control ?? flags["control-image"] ?? flags.control_image;
  if (initFlag !== undefined && controlFlag !== undefined) {
    throw new Error(
      "--init and --control are different operations; pass one.\n" +
      "  --init    repaint that picture (img2img)\n" +
      "  --control build a new one around its structure (ControlNet)"
    );
  }
  const maskFlag = flags.mask;
  if (maskFlag !== undefined && initFlag === undefined) {
    throw new Error("--mask needs --init: inpainting repaints part of a picture you supply");
  }
  if (initFlag !== undefined) {
    put("init_image", readImageFlag(initFlag, "--init"));
    put("denoising_strength", num(flags.denoise ?? flags["denoising-strength"] ?? flags.denoising_strength));
  }
  if (maskFlag !== undefined) {
    put("mask", readImageFlag(maskFlag, "--mask"));
    put("mask_blur", num(flags["mask-blur"] ?? flags.mask_blur));
    // Named rather than numeric: nobody remembers that 2 means latent noise,
    // and it is the knob that decides whether the prompt lands at all.
    const fill = str(flags["inpaint-fill"] ?? flags.inpaint_fill);
    if (fill) {
      const FILLS = { fill: 0, original: 1, noise: 2, nothing: 3 };
      if (!(fill in FILLS)) {
        throw new Error(`--inpaint-fill: unknown "${fill}". Use: ${Object.keys(FILLS).join(" | ")}`);
      }
      put("inpainting_fill", FILLS[fill]);
    }
  }
  if (controlFlag !== undefined) {
    put("control_image", readImageFlag(controlFlag, "--control"));
    put("control_strength", num(flags["control-strength"] ?? flags.control_strength));
  }
  return body;
}

/** Open a file in the OS viewer. Best-effort — never fails the command. */
function openFile(file) {
  const bin = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "explorer"
    : "xdg-open";
  try {
    spawn(bin, [file], { detached: true, stdio: "ignore" }).unref();
  } catch { /* no viewer is not an error */ }
}

/**
 * Copy the daemon's file to --out. Copy, not move: the gallery under ~/.apx
 * stays the durable record, so a later `--out` overwrite never loses the only
 * copy of a picture.
 */
function copyOut(srcPath, outFlag, index, total) {
  let dest = path.resolve(outFlag);
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    dest = path.join(dest, path.basename(srcPath));
  } else if (total > 1 && index > 0) {
    // Several images, one --out name: number them rather than overwrite.
    const ext = path.extname(dest);
    dest = path.join(path.dirname(dest), `${path.basename(dest, ext)}-${index + 1}${ext}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcPath, dest);
  return dest;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  // Sub-kilobyte files are real (the mock engine writes a 180-byte swatch);
  // rounding them to "0 KB" reads as a failure.
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function cmdProviders(flags) {
  const info = await http.get("/api/images/providers");
  if (flags.json) {
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    `${bold("Routing")}  ${info.mode}` +
    (info.mode === "single" ? ` → ${cy(info.configured_provider)}` : ` (${info.order.join(" → ")})`) +
    "\n\n"
  );
  for (const e of info.engines || []) {
    const mark = e.available ? ok("●") : dim("○");
    const state = [
      e.available ? "reachable" : "unreachable",
      e.configured ? "configured" : "not configured",
      e.enabled ? null : "disabled",
    ].filter(Boolean).join(", ");
    const label = e.label && e.label !== e.id ? ` ${dim(`(${e.label})`)}` : "";
    process.stdout.write(`  ${mark} ${bold(e.id)}${label}  ${dim(state)}\n`);
    if (e.note) process.stdout.write(`      ${dim(e.note)}\n`);
  }
  const d = info.defaults || {};
  process.stdout.write(
    `\n${dim(`Defaults: ${d.width}x${d.height}, ${d.steps} steps, cfg ${d.cfg_scale}, ${d.format}`)}\n`
  );
}

async function cmdCapabilities(flags) {
  const q = flags.provider ? `?provider=${encodeURIComponent(String(flags.provider))}` : "";
  const info = await http.get(`/api/images/capabilities${q}`);
  if (flags.json) {
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }
  const caps = info.capabilities;
  process.stdout.write(`${bold(info.provider)}\n`);
  if (!caps) {
    process.stdout.write(dim("  No catalog — the engine is unreachable or has no discovery route.\n"));
    return;
  }
  const row = (label, list) => {
    if (!list?.length) return;
    process.stdout.write(`  ${bold(label)}  ${list.join(", ")}\n`);
  };
  row("Models    ", caps.models);
  row("Samplers  ", caps.samplers);
  row("Schedulers", caps.schedulers);
  row("Formats   ", caps.formats);
  if (caps.defaults?.width) {
    process.stdout.write(dim(`  Server defaults: ${caps.defaults.width}x${caps.defaults.height}\n`));
  }
}

export async function cmdImage(args) {
  const flags = args.flags || {};
  const first = args._[0];

  if (SUBCOMMANDS.has(first) && !str(flags.prompt)) {
    if (first === "providers") return cmdProviders(flags);
    if (first === "capabilities") return cmdCapabilities(flags);
  }

  const prompt = str(flags.prompt) || args._.filter(Boolean).join(" ").trim();
  if (!prompt) {
    process.stderr.write(err("apx image: missing prompt") + "\n" + dim(USAGE) + "\n");
    process.exitCode = 1;
    return;
  }

  let body;
  try {
    body = { prompt, ...requestFrom(flags) };
  } catch (e) {
    process.stderr.write(err(`apx image: ${e.message}`) + "\n");
    process.exitCode = 1;
    return;
  }
  const quiet = !!flags.json;
  if (!quiet) {
    process.stderr.write(dim(`Generating… ${prompt.length > 60 ? prompt.slice(0, 60) + "…" : prompt}`) + "\n");
  }

  let result;
  try {
    result = await http.post("/api/images/generate", body);
  } catch (e) {
    process.stderr.write(err(`apx image: ${e.message}`) + "\n");
    process.exitCode = 1;
    return;
  }

  const images = result.images || [];
  const written = images.map((img, i) =>
    (flags.out ? copyOut(img.path, String(flags.out), i, images.length) : img.path));

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...result, written }, null, 2) + "\n");
  } else {
    for (const file of written) process.stdout.write(file + "\n");
    const secs = (result.elapsed_ms / 1000).toFixed(1);
    const bits = [
      result.provider,
      result.meta?.mode && result.meta.mode !== "txt2img" ? result.meta.mode : null,
      result.model || null,
      `${result.request?.width}x${result.request?.height}`,
      images[0]?.seed != null ? `seed ${images[0].seed}` : null,
      formatBytes(images[0]?.bytes),
      `${secs}s`,
    ].filter(Boolean);
    process.stderr.write(dim(`  ${bits.join(" · ")}`) + "\n");
    // Say what the engine could not honor — a silently ignored --steps is the
    // difference between "this looks wrong" and "that engine has no steps".
    if (result.ignored?.length) {
      process.stderr.write(
        warn(`  ${result.provider} ignored: ${result.ignored.join(", ")}`) + "\n"
      );
    }
  }

  if (flags.open) written.forEach(openFile);
}
