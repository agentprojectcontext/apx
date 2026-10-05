// Local transcription from the app: what this machine runs well, and installing a model for it (see local-whisper.ts).
import type { LocalTranscription } from "@apx/protocol";
import { badRequest, errorMessage } from "../errors.ts";
import { installHint, LOCAL_MODELS, type ModelInstaller, machine, recommend } from "../services/local-whisper.ts";
import type { Services } from "../services/registry.ts";
import type { Handlers } from "./router.ts";

/** The service the installer sets up; the owner may add other whisper.cpp services by hand. */
export const LOCAL_SERVICE = "local-whisper";

/** A downloaded model becomes the local transcription service, tried first; the rest keep their order after it. */
export function useLocalModel(services: Services, file: string, language = "es"): void {
  services.set(LOCAL_SERVICE, {
    kind: "transcription",
    dialect: "whisper-cpp",
    label: "whisper.cpp (local)",
    base_url: "http://127.0.0.1",
    enabled: true,
    needs_key: false,
    model: file,
    language,
  });
  services.order("transcription", [LOCAL_SERVICE]);
}

export function transcriptionHandlers(services: Services, installer: ModelInstaller) {
  const status = async (): Promise<LocalTranscription> => {
    const m = machine();
    const local = (await services.info("transcription")).find((s) => s.id === LOCAL_SERVICE);
    const active = LOCAL_MODELS.find((x) => local?.model?.endsWith(`ggml-${x.id}.bin`))?.id;
    const download = installer.progress();
    return {
      machine: { ...m, server: Boolean(m.server) },
      ...(!m.server || !m.ffmpeg ? { install_hint: installHint(m.platform) } : {}),
      recommended: recommend(m),
      models: LOCAL_MODELS.map((x) => ({ ...x, installed: installer.installed(x.id) })),
      ...(download ? { download } : {}),
      ...(active ? { active } : {}),
    };
  };
  return {
    "transcription.local": () => status(),
    "transcription.install": async ({ model }) => {
      try {
        installer.install(model);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return status();
    },
  } satisfies Partial<Handlers>;
}
