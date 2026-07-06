// Best-effort detection of installed agent CLIs and LLM runners.
// We just probe the binary with `--version` (or equivalent) and don't fail if
// it isn't there — caller decides what to do with absence.
import { runProcess } from "#host/daemon/runtimes/_spawn.js";
import { resolveAntigravityCli } from "#host/daemon/runtimes/antigravity.js";

const PROBES = [
  // Coding-agent CLIs (runtimes/)
  { id: "claude-code", binary: "claude",    args: ["--version"], category: "runtime" },
  { id: "codex",       binary: "codex",     args: ["--version"], category: "runtime" },
  { id: "opencode",    binary: "opencode",  args: ["--version"], category: "runtime" },
  { id: "aider",       binary: "aider",     args: ["--version"], category: "runtime" },
  { id: "gemini-cli",  binary: "gemini",    args: ["--version"], category: "runtime" },
  { id: "cursor-agent",binary: "cursor-agent", args: ["--version"], category: "runtime" },
  { id: "qwen-code",   binary: "qwen",      args: ["--version"], category: "runtime" },
  // Antigravity IDE ships its CLI inside the app bundle (not on PATH), so we
  // resolve the absolute path rather than relying on the bare binary name.
  { id: "antigravity", binary: "antigravity-ide", args: ["--version"], category: "runtime", resolve: resolveAntigravityCli },

  // Local LLM runners (engines/)
  { id: "ollama",      binary: "ollama",    args: ["--version"], category: "engine" },
  { id: "llama-cpp",   binary: "llama",     args: ["--version"], category: "engine" },

  // Tooling
  { id: "node",        binary: "node",      args: ["--version"], category: "tool" },
  { id: "python3",     binary: "python3",   args: ["--version"], category: "tool" },
  { id: "uv",          binary: "uv",        args: ["--version"], category: "tool" },
  { id: "git",         binary: "git",       args: ["--version"], category: "tool" },
];

export async function detectAll() {
  const results = [];
  for (const p of PROBES) {
    const r = await probe(p);
    results.push(r);
  }
  return results;
}

async function probe(p) {
  const start = Date.now();
  try {
    // Some runtimes (e.g. Antigravity) aren't on PATH — resolve an absolute
    // path first; if the resolver finds nothing, report not-installed early.
    let command = p.binary;
    if (typeof p.resolve === "function") {
      const resolved = p.resolve();
      if (!resolved) {
        return {
          id: p.id,
          binary: p.binary,
          category: p.category,
          installed: false,
          reason: "not found",
        };
      }
      command = resolved;
    }
    const r = await runProcess({
      command,
      args: p.args,
      timeoutMs: 3000,
    });
    if (r.exitCode === 0 || (r.stdout && r.stdout.trim())) {
      return {
        id: p.id,
        binary: p.binary,
        category: p.category,
        installed: true,
        version: r.stdout.trim().split("\n")[0] || r.stderr.trim().split("\n")[0] || "unknown",
        latency_ms: Date.now() - start,
      };
    }
    return {
      id: p.id,
      binary: p.binary,
      category: p.category,
      installed: false,
      reason: r.error || `exit ${r.exitCode}`,
    };
  } catch (e) {
    return {
      id: p.id,
      binary: p.binary,
      category: p.category,
      installed: false,
      reason: e.message,
    };
  }
}
