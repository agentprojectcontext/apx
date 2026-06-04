import { useMemo, useState } from "react";
import useSWR from "swr";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { VoiceProviderList } from "../../components/voice/VoiceProviderList";
import { VoiceProviderModal, type VoiceProviderSave } from "../../components/voice/VoiceProviderModal";
import { VoiceTestCard } from "../../components/voice/VoiceTestCard";
import { VoiceSttCard } from "../../components/voice/VoiceSttCard";
import { Voice, type TranscriptionConfig, type TtsMode, type VoiceTtsConfig } from "../../lib/api/voice";

// Voices module — configure TTS/STT providers, pick the default engine, and
// test playback. TTS provider availability comes from the daemon
// (/tts/providers); per-engine config + the default + STT settings persist via
// the admin config PATCH (voice.tts.* / transcription.*).
export function VoiceScreen() {
  const toast = useToast();
  const { config, isLoading: cfgLoading, patch, mutate: mutateCfg } = useGlobalConfig();
  const {
    data: providersData,
    isLoading: provLoading,
    error: provError,
    mutate: mutateProviders,
  } = useSWR("/tts/providers", () => Voice.providers());

  const [editing, setEditing] = useState<string | null>(null);
  const [busyDefault, setBusyDefault] = useState(false);

  // config.voice is typed as Record<string,unknown> and transcription isn't on
  // GlobalConfig (owned by another agent) — read both off a local view.
  const cfgView = config as unknown as {
    voice?: { tts?: VoiceTtsConfig };
    transcription?: TranscriptionConfig;
  };
  const voiceCfg = (cfgView.voice?.tts || {}) as VoiceTtsConfig;
  const transcriptionCfg = (cfgView.transcription || {}) as TranscriptionConfig;
  const configuredProvider = providersData?.configured_provider || voiceCfg.provider || "auto";
  const mode: TtsMode = providersData?.mode || voiceCfg.mode || "chain";
  const engines = providersData?.engines || [];
  const order = providersData?.order || [];

  const editingConfig = useMemo<Record<string, unknown>>(() => {
    if (!editing) return {};
    return (voiceCfg as Record<string, unknown>)[editing] as Record<string, unknown> || {};
  }, [editing, voiceCfg]);

  const setDefault = async (id: string) => {
    setBusyDefault(true);
    try {
      await patch({ "voice.tts.provider": id, "voice.tts.mode": "single" });
      await mutateProviders();
      toast.success(`Motor por defecto: ${id}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDefault(false);
    }
  };

  const setMode = async (next: TtsMode) => {
    setBusyDefault(true);
    try {
      const set: Record<string, unknown> = { "voice.tts.mode": next };
      // Switching to single needs a concrete default; pick the first available
      // (or first listed) engine when none is set yet.
      if (next === "single" && (configuredProvider === "auto" || !configuredProvider)) {
        const pick = engines.find((e) => e.available)?.id || order[0] || "mock";
        set["voice.tts.provider"] = pick;
      }
      await patch(set);
      await mutateProviders();
      toast.success(next === "chain" ? "Modo: cadena con fallback." : "Modo: solo el motor por defecto.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDefault(false);
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusyDefault(true);
    try {
      await patch({ [`voice.tts.${id}.enabled`]: enabled });
      await mutateProviders();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDefault(false);
    }
  };

  const reorder = async (nextOrder: string[]) => {
    setBusyDefault(true);
    try {
      await patch({ "voice.tts.order": nextOrder });
      await mutateProviders();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDefault(false);
    }
  };

  const saveProvider = async ({ set, unset }: VoiceProviderSave) => {
    await patch(set, unset.length ? unset : undefined);
    await mutateProviders();
    await mutateCfg();
    toast.success("Configuración de voz guardada.");
  };

  const patchStt = async (set: Record<string, unknown>, unset?: string[]) => {
    try {
      await patch(set, unset);
      toast.success("Transcripción actualizada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="screen-voice">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Voces</h1>
        <p className="text-sm text-muted-fg">
          Configurá el texto a voz (TTS) y la transcripción (STT), elegí el motor por defecto y probá la voz.
        </p>
      </header>

      <Section
        title="Proveedores de voz (TTS)"
        description="Motores de síntesis. El estado lo reporta el daemon en vivo. Elegí cuál usar por defecto."
      >
        {provLoading || cfgLoading ? (
          <Loading />
        ) : provError ? (
          <Empty>No se pudieron cargar los proveedores: {(provError as Error).message}</Empty>
        ) : (
          <VoiceProviderList
            engines={engines}
            order={order}
            mode={mode}
            configuredProvider={configuredProvider}
            onSetMode={setMode}
            onSetDefault={setDefault}
            onToggleEnabled={toggleEnabled}
            onReorder={reorder}
            onConfigure={(id) => setEditing(id)}
            busy={busyDefault}
          />
        )}
      </Section>

      <Section title="Probar voz" description='Elegí con qué motor sintetizar y, si aplica, cómo querés que hable.'>
        <VoiceTestCard engines={engines} defaultProvider={configuredProvider} mode={mode} />
      </Section>

      <Section
        title="Transcripción (STT)"
        description="Motor de voz a texto que usan el deck, Telegram y la CLI al escuchar."
      >
        {cfgLoading ? <Loading /> : <VoiceSttCard config={transcriptionCfg} onPatch={patchStt} />}
      </Section>

      <VoiceProviderModal
        open={!!editing}
        providerId={editing}
        config={editingConfig}
        onClose={() => setEditing(null)}
        onSave={saveProvider}
      />
    </div>
  );
}
