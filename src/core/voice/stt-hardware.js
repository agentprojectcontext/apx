// Hardware probe + STT engine recommendation.
//
// The transcription backend should adapt to the machine instead of making the
// user understand CTranslate2 vs MLX vs whisper.cpp:
//
//   Apple Silicon (Metal)  → mlx-whisper, large-v3-turbo   (GPU/ANE accelerated)
//   NVIDIA (CUDA)          → faster-whisper cuda, large-v3  (GPU accelerated)
//   AMD / Radeon           → faster-whisper cpu (limited)   (no ROCm in CT2)
//   CPU only               → faster-whisper cpu, small      (safe + light)
//
// Detection is dependency-free and best-effort: short-timeout probes of
// nvidia-smi / rocminfo, plus os.platform()/os.arch(). Anything uncertain
// degrades to the CPU recommendation.
import os from "node:os";
import { spawnSync } from "node:child_process";

function cmdOk(cmd, args = []) {
  try {
    const r = spawnSync(cmd, args, { timeout: 1500, stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Probe the machine. Returns a stable shape the UI + recommender consume.
 * @returns {{platform:string, arch:string, appleSilicon:boolean, gpu:"metal"|"cuda"|"rocm"|"none", gpuName?:string}}
 */
export function detectHardware() {
  const platform = os.platform();           // "darwin" | "linux" | "win32"
  const arch = os.arch();                    // "arm64" | "x64" | ...
  const appleSilicon = platform === "darwin" && arch === "arm64";

  if (appleSilicon) {
    return { platform, arch, appleSilicon: true, gpu: "metal", gpuName: cpuBrand() };
  }
  // NVIDIA: nvidia-smi exits 0 when a CUDA GPU + driver are present.
  if (cmdOk("nvidia-smi", ["-L"])) {
    return { platform, arch, appleSilicon: false, gpu: "cuda" };
  }
  // AMD/Radeon: rocminfo (ROCm stack) is the clearest signal on Linux.
  if (platform === "linux" && cmdOk("rocminfo")) {
    return { platform, arch, appleSilicon: false, gpu: "rocm" };
  }
  return { platform, arch, appleSilicon: false, gpu: "none" };
}

function cpuBrand() {
  try { return (os.cpus()?.[0]?.model || "").trim() || undefined; } catch { return undefined; }
}

// Recommended STT backend + model per hardware tier. `backend` maps to a local
// engine implementation; `model` is the repo id in that engine's format.
export function recommendStt(hw = detectHardware()) {
  if (hw.gpu === "metal") {
    return {
      backend: "mlx", device: "metal",
      model: "mlx-community/whisper-large-v3-turbo",
      reason: "Apple Silicon: MLX corre en la GPU/Neural Engine (Metal).",
      tier: "gpu",
    };
  }
  if (hw.gpu === "cuda") {
    return {
      backend: "faster", device: "cuda", compute_type: "float16",
      model: "large-v3",
      reason: "GPU NVIDIA: faster-whisper en CUDA soporta modelos grandes rápido.",
      tier: "gpu",
    };
  }
  if (hw.gpu === "rocm") {
    return {
      backend: "faster", device: "cpu", compute_type: "int8",
      model: "small",
      reason: "Radeon/ROCm no está soportado por CTranslate2 — se usa CPU. (whisper.cpp Vulkan es una mejora futura.)",
      tier: "cpu",
      limited: true,
    };
  }
  return {
    backend: "faster", device: "cpu", compute_type: "int8",
    model: "small",
    reason: "Sin GPU acelerada: faster-whisper en CPU con un modelo liviano.",
    tier: "cpu",
  };
}
