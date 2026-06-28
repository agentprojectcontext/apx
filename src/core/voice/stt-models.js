// STT model catalog + on-disk status (downloaded? how big?).
//
// Both engines pull their weights from the HuggingFace hub cache
// (~/.cache/huggingface/hub/models--<org>--<name>), just in different formats:
//   faster-whisper → Systran/faster-whisper-<model>   (CTranslate2)
//   mlx-whisper    → mlx-community/whisper-<model>     (MLX)
//
// We read the cache directory to report presence + real byte size, and carry an
// approximate download size for models that aren't there yet (Ollama-style).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function hubDir() {
  const base = process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface");
  return path.join(base, "hub");
}

/** HF cache folder name for a repo id, e.g. "Systran/faster-whisper-small". */
function repoCacheName(repoId) {
  return "models--" + repoId.replace(/\//g, "--");
}

function dirSizeBytes(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      // HF stores real bytes once in blobs/ and symlinks them from snapshots/.
      // Count only the real files (skip symlinks) so we don't double-count.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.lstatSync(p).size; } catch {} }
    }
  }
  return total;
}

export function humanSize(bytes) {
  if (!bytes || bytes < 1) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// Catalog: per backend, the offered models with their HF repo id and an
// approximate download size (used only until the model is actually on disk).
export const STT_MODEL_CATALOG = {
  faster: [
    { id: "tiny",           repo: "Systran/faster-whisper-tiny",            approx_mb: 75 },
    { id: "base",           repo: "Systran/faster-whisper-base",            approx_mb: 145 },
    { id: "small",          repo: "Systran/faster-whisper-small",           approx_mb: 480 },
    { id: "medium",         repo: "Systran/faster-whisper-medium",          approx_mb: 1500 },
    { id: "large-v3",       repo: "Systran/faster-whisper-large-v3",        approx_mb: 3100 },
    { id: "large-v3-turbo", repo: "mobiuslabsgmbh/faster-whisper-large-v3-turbo", approx_mb: 1600 },
  ],
  mlx: [
    { id: "small",          repo: "mlx-community/whisper-small-mlx",            approx_mb: 480 },
    { id: "large-v3",       repo: "mlx-community/whisper-large-v3-mlx",         approx_mb: 3100 },
    { id: "large-v3-turbo", repo: "mlx-community/whisper-large-v3-turbo",       approx_mb: 1600 },
  ],
};

/** Status of one repo in the HF cache. */
export function modelStatusByRepo(repo) {
  const dir = path.join(hubDir(), repoCacheName(repo));
  if (!fs.existsSync(dir)) return { downloaded: false, size_bytes: 0 };
  const size = dirSizeBytes(dir);
  // A bare ref/lock dir with no blobs is "not really downloaded".
  return { downloaded: size > 1_000_000, size_bytes: size };
}

/** List a backend's models with download status + sizes. */
export function listSttModels(backend) {
  const catalog = STT_MODEL_CATALOG[backend] || [];
  return catalog.map((m) => {
    const st = modelStatusByRepo(m.repo);
    return {
      id: m.id,
      repo: m.repo,
      downloaded: st.downloaded,
      size: st.downloaded ? humanSize(st.size_bytes) : `~${humanSize(m.approx_mb * 1024 * 1024)}`,
      size_bytes: st.size_bytes,
    };
  });
}

/** Resolve the HF repo id for a (backend, model-id) pair. */
export function repoFor(backend, modelId) {
  const entry = (STT_MODEL_CATALOG[backend] || []).find((m) => m.id === modelId);
  return entry?.repo || modelId; // allow passing a raw repo id through
}
