// Images drawn by the owner's own Codex with its built-in image_gen tool, on their ChatGPT plan: a short read-only
// Codex session asked only to draw. Codex reports no event for the image, so it is taken from Codex's own folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServiceSettings } from "@apx/protocol";
import { Codex } from "@openai/codex-sdk";
import { errorMessage } from "../errors.ts";
import type { ImageRequest } from "./images.ts";
import { IMAGE_TIMEOUT_MS, type ImageResult, type ServiceConfig, ServiceError, sniffImage } from "./types.ts";

/** The id APX gives the Codex image service it adds on its own. */
export const CODEX_IMAGES = "codex";

/** What APX adds once Codex is signed in on this machine: first of the image services. */
export const CODEX_IMAGE_SERVICE: ServiceSettings = {
  kind: "image",
  dialect: "codex-images",
  label: "Codex (ChatGPT plan)",
  base_url: "http://127.0.0.1",
  enabled: true,
  needs_key: false,
};

const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;

/** Where Codex keeps the images its image_gen tool made in one of its threads. */
export function codexImageDir(env: Record<string, string>, codexThread: string): string {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "generated_images", codexThread);
}

/** The image files in `dir`, oldest first; none when it does not exist. */
export function imagesIn(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f));
  } catch {
    return [];
  }
  const at = (f: string) => fs.statSync(path.join(dir, f)).mtimeMs;
  return names.sort((a, b) => at(a) - at(b));
}

function shapeOf(w: number, h: number): string {
  if (w === h) return "square";
  return w > h ? `landscape (about ${w}x${h})` : `portrait (about ${w}x${h})`;
}

/** What Codex is told: draw, nothing else (no files, no commands, no skills to read first). */
function promptFor(r: ImageRequest): string {
  return [
    `Use your built-in image_gen tool now to make ${r.count === 1 ? "one image" : `${r.count} separate images`}, ${shapeOf(r.width, r.height)}.`,
    "Do not run commands, read files or skills, or write files: only call image_gen, then answer in one short line.",
    ...(r.references?.length
      ? [
          `The ${r.references.length === 1 ? "attached image is a reference" : `${r.references.length} attached images are references`}: take from them what the description asks for (style, layout, subject), and make a new image rather than a copy.`,
        ]
      : []),
    `Description: ${r.prompt}`,
    ...(r.negative_prompt ? [`Avoid: ${r.negative_prompt}`] : []),
  ].join("\n");
}

export type CodexImages = ReturnType<typeof createCodexImages>;

export function createCodexImages(deps: {
  /** The owner's `codex`, when it is installed. */
  codexPath(): Promise<string | undefined>;
  /** Whether Codex is signed in here (its own answer, cached by the engines' status). */
  signedIn(): Promise<boolean>;
  env(): Record<string, string>;
  /** An empty folder Codex runs in: it never sees a project. */
  workDir: string;
}) {
  async function draw(s: ServiceConfig, r: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    try {
      const bin = await deps.codexPath();
      if (!bin) throw new Error("Codex is not installed on this machine");
      const env = deps.env();
      fs.mkdirSync(deps.workDir, { recursive: true });
      const thread = new Codex({ codexPathOverride: bin, env }).startThread({
        workingDirectory: deps.workDir,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        modelReasoningEffort: "low",
        ...(s.model ? { model: s.model } : {}),
      });
      const refs = (r.references ?? []).map((ref) => ({ type: "local_image" as const, path: ref.path }));
      const input = refs.length ? [{ type: "text" as const, text: promptFor(r) }, ...refs] : promptFor(r);
      const turn = await thread.run(input, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]),
      });
      const dir = thread.id ? codexImageDir(env, thread.id) : "";
      const files = dir ? imagesIn(dir).slice(0, r.count) : [];
      if (!files.length) throw new Error(`no image came back${turn.finalResponse ? `: ${turn.finalResponse}` : ""}`);
      return {
        images: files.map((f) => {
          const bytes = fs.readFileSync(path.join(dir, f));
          return { bytes, mime: sniffImage(bytes) };
        }),
        model: s.model ?? "image_gen",
      };
    } catch (err) {
      throw new ServiceError(s.label, errorMessage(err, 300));
    }
  }
  return { available: deps.signedIn, draw };
}
