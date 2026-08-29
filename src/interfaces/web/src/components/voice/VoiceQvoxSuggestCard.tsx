// The local-voice suggestion, offered where the absence is felt.
//
// Every cloud engine in the list bills per minute and sends the audio out of
// the machine. On Apple Silicon there is a third option that neither does, but
// only if you already know it exists — so it is named here, next to the
// providers, and only while it is missing.
import { Button } from "../ui/button";
import { t } from "../../i18n";
import { usePersonaName } from "../../hooks/usePersonaName";
import { QVOX_REPO } from "../../lib/qvox";

// English on purpose, like the Sessions tab's "ask the persona" — the
// super-agent's language is not known here, and the user appends their own
// instructions after the colon.
const ASK_PROMPT =
  "Install QVox (local Qwen3-TTS on Apple Silicon) and wire it into APX as a voice provider. " +
  "Steps: check that Node 18+ and `uv` are installed (`brew install uv` if missing — the npm package " +
  "installs only the Node CLI, and the engine runs through `uv run`, so it will not start without it); " +
  "`npm install -g qwen3-tts-api`; `qvox setup`, which creates the config and folders and checks the " +
  "dependencies; `qvox models download` for the first model, a multi-gigabyte download; " +
  "`qvox serve` and leave it running on 127.0.0.1:5111; " +
  "then add it in APX as a custom OpenAI-compatible TTS provider with base_url http://127.0.0.1:5111/v1. " +
  `Repo: ${QVOX_REPO}. ` +
  "Tell me what you did and what is still missing. With these instructions: ";

export function VoiceQvoxSuggestCard() {
  const persona = usePersonaName();

  const ask = () => {
    // The sheet opens with this loaded but unsent, so the user reads it first.
    window.dispatchEvent(
      new CustomEvent("apx:roby-prompt", { detail: { prompt: ASK_PROMPT } })
    );
  };

  return (
    <div
      className="rounded-xl border border-dashed border-border p-5"
      data-testid="qvox-suggest"
    >
      <h3 className="text-sm font-semibold text-foreground">{t("voice_ui.qvox_title")}</h3>
      <p className="mt-1.5 text-sm text-muted-fg">{t("voice_ui.qvox_body")}</p>

      <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-fg">
        <code>{"brew install uv\nnpm install -g qwen3-tts-api\nqvox setup\nqvox serve"}</code>
      </pre>
      <p className="mt-2 text-xs text-muted-fg">{t("voice_ui.qvox_note")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={ask}>
          {t("voice_ui.qvox_ask", { persona })}
        </Button>
        <a
          href={QVOX_REPO}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-fg underline underline-offset-2 hover:text-foreground"
        >
          {t("voice_ui.qvox_repo")}
        </a>
      </div>
    </div>
  );
}
