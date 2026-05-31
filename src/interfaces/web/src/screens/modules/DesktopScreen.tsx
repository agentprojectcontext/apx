import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Section, Kbd, StatusDot } from "../../components/Section";
import { Button, Field, Input, Switch, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Desktop } from "../../lib/api/desktop";

const DEFAULT_SHORTCUT = "CommandOrControl+G";

// Desktop module — manage the floating voice window (the Electron app launched
// with `apx desktop start`). The window is a separate process spawned by the
// CLI, so the web admin can't start it; it shows live connection status and
// edits the persisted config (desktop.shortcut, desktop.enabled).
export function DesktopScreen() {
  const toast = useToast();
  const { config, isLoading: cfgLoading, patch } = useGlobalConfig();

  // config.desktop isn't on the typed GlobalConfig — read it off a local view.
  const cfgView = config as unknown as {
    desktop?: { shortcut?: string; enabled?: boolean };
    overlay?: { shortcut?: string }; // legacy fallback
  };
  const savedShortcut = cfgView.desktop?.shortcut || cfgView.overlay?.shortcut || DEFAULT_SHORTCUT;
  const enabled = cfgView.desktop?.enabled !== false;

  const { data: status, isLoading: stLoading } = useSWR(
    "/desktop/status",
    () => Desktop.status(),
    { refreshInterval: 5000 },
  );
  const running = (status?.connected_clients ?? 0) > 0;

  const [shortcut, setShortcut] = useState(savedShortcut);
  const [busy, setBusy] = useState(false);
  useEffect(() => setShortcut(savedShortcut), [savedShortcut]);

  const saveShortcut = async () => {
    const next = shortcut.trim();
    if (!next || next === savedShortcut) return;
    setBusy(true);
    try {
      await patch({ "desktop.shortcut": next });
      toast.success("Atajo guardado. Reiniciá la ventana (apx desktop stop && start) para aplicarlo.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (v: boolean) => {
    setBusy(true);
    try {
      await patch({ "desktop.enabled": v });
      toast.success(v ? "Desktop activado." : "Desktop desactivado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="screen-desktop">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Escritorio</h1>
        <p className="text-sm text-muted-fg">
          La ventana flotante de voz (Electron): botón de acceso rápido, escucha por micrófono y muestra el chat.
        </p>
      </header>

      <Section
        title="Estado"
        description="La ventana se lanza desde la terminal; acá ves si hay alguna conectada al daemon."
      >
        {stLoading ? (
          <Loading />
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <StatusDot ok={running} />
            <span className="font-medium">{running ? "En ejecución" : "Detenido"}</span>
            <span className="text-muted-fg">
              · {status?.connected_clients ?? 0} ventana(s) conectada(s)
            </span>
          </div>
        )}
        <div className="mt-4 space-y-1 text-sm text-muted-fg">
          <p>Para abrir la ventana desde la terminal:</p>
          <p className="font-mono text-xs">
            <Kbd>apx desktop start</Kbd> <span className="opacity-60">— o</span>{" "}
            <Kbd>apx desktop start --debug</Kbd>
          </p>
          <p className="text-xs">
            Una vez abierta, usá el atajo global para mostrarla y empezar a escuchar.
          </p>
        </div>
      </Section>

      <Section
        title="Atajo de teclado"
        description="Botón de acceso rápido global que muestra/oculta la ventana y arranca a escuchar."
      >
        {cfgLoading ? (
          <Loading />
        ) : (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field
                label="Acelerador"
                hint='Formato Electron, p. ej. "CommandOrControl+G" o "CommandOrControl+Shift+Space". Reiniciá la ventana para aplicar.'
              >
                <Input
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveShortcut(); }}
                  placeholder={DEFAULT_SHORTCUT}
                  className="max-w-md font-mono"
                  disabled={busy}
                />
              </Field>
            </div>
            <Button
              variant="primary"
              onClick={saveShortcut}
              loading={busy}
              disabled={!shortcut.trim() || shortcut.trim() === savedShortcut}
            >
              Guardar
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="Activación"
        description="Cuando está desactivado, el daemon no responde los mensajes de la ventana de escritorio."
      >
        {cfgLoading ? (
          <Loading />
        ) : (
          <Switch checked={enabled} onChange={toggleEnabled} disabled={busy} label={enabled ? "Activado" : "Desactivado"} />
        )}
      </Section>

      <Section
        title="Transcripción"
        description="La ventana escucha por micrófono y transcribe con el motor de voz a texto (STT)."
      >
        <p className="text-sm text-muted-fg">
          El STT se configura en{" "}
          <Link to="/m/voice" className="font-medium text-fg underline underline-offset-2">
            Voces
          </Link>{" "}
          (motor, modelo de whisper, idioma). El escritorio usa siempre el motor local en tiempo real.
        </p>
      </Section>
    </div>
  );
}
