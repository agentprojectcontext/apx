import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Section, Kbd, StatusDot } from "../../components/Section";
import { Button, Field, Input, Switch, Loading, Empty } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Desktop, fetchDesktopMessages, type GlobalMessage } from "../../lib/api/desktop";

const DEFAULT_SHORTCUT = "CommandOrControl+G";
const POSITION_OPTS = [
  { value: "left",   label: "Izquierda" },
  { value: "center", label: "Centro" },
  { value: "right",  label: "Derecha" },
];
const THEME_OPTS = [
  { value: "light", label: "Claro" },
  { value: "dark",  label: "Oscuro" },
];

// Desktop module — manage the floating voice window (the Electron app launched
// with `apx desktop start`). The window is a separate process spawned by the
// CLI, so the web admin doesn't start/stop it — it edits persisted config,
// toggles per-user autostart, and previews the last conversation.
export function DesktopScreen() {
  const toast = useToast();
  const { config, isLoading: cfgLoading, patch } = useGlobalConfig();

  // config.desktop isn't on the typed GlobalConfig — read it off a local view.
  const cfgView = config as unknown as {
    desktop?: {
      shortcut?: string; enabled?: boolean;
      theme?: "light" | "dark";
      position?: "left" | "center" | "right";
    };
    overlay?: { shortcut?: string }; // legacy fallback
  };
  const savedShortcut = cfgView.desktop?.shortcut || cfgView.overlay?.shortcut || DEFAULT_SHORTCUT;
  const enabled  = cfgView.desktop?.enabled !== false;
  const theme    = cfgView.desktop?.theme    || "light";
  const position = cfgView.desktop?.position || "right";

  const { data: status, isLoading: stLoading, mutate: mutateStatus } = useSWR(
    "/desktop/status",
    () => Desktop.status(),
    { refreshInterval: 5000 },
  );
  const running = !!status?.running;

  const { data: autostart, mutate: mutateAutostart } = useSWR(
    "/desktop/autostart",
    () => Desktop.autostartGet(),
  );

  const { data: msgs, isLoading: msgsLoading, mutate: mutateMsgs } = useSWR(
    "/messages/global?channel=desktop",
    () => fetchDesktopMessages(40),
    { refreshInterval: 8000 },
  );

  const [shortcut, setShortcut] = useState(savedShortcut);
  const [busy, setBusy] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  useEffect(() => setShortcut(savedShortcut), [savedShortcut]);

  const saveShortcut = async () => {
    const next = shortcut.trim();
    if (!next || next === savedShortcut) return;
    setBusy(true);
    try {
      await patch({ "desktop.shortcut": next });
      toast.success("Atajo guardado. Reiniciá la ventana (apx desktop stop && start) para aplicarlo.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const patchKey = async (key: string, value: unknown, ok: string) => {
    setBusy(true);
    try {
      await patch({ [key]: value });
      toast.success(ok);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleAutostart = async (v: boolean) => {
    setAutostartBusy(true);
    try {
      await Desktop.autostartSet(v);
      await mutateAutostart();
      toast.success(v ? "Autostart activado para el próximo login." : "Autostart desactivado.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setAutostartBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="screen-desktop">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Escritorio</h1>
        <p className="text-sm text-muted-fg">
          Ventana flotante de voz (Electron): atajo global, escucha por micrófono y muestra el chat.
        </p>
      </header>

      {/* ── Two-column layout: config on the left, last conversation on the right. ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* ── LEFT: configuration + status ─────────────────────────────── */}
        <div className="space-y-6">
          <Section title="Estado" description="La ventana se lanza desde la terminal o por autostart.">
            {stLoading ? <Loading /> : (
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={running} />
                <span className="font-medium">{running ? "En ejecución" : "Detenida"}</span>
                <button
                  type="button"
                  onClick={() => mutateStatus()}
                  className="ml-2 text-xs text-muted-fg underline-offset-2 hover:underline"
                >
                  refrescar
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-fg">
              Desde terminal: <Kbd>apx desktop start</Kbd> · <Kbd>apx desktop --debug</Kbd>
            </p>
          </Section>

          <Section
            title="Arranque automático"
            description="Lanza la ventana al iniciar sesión del usuario. Equivalente a `apx desktop install` (no requiere sudo)."
          >
            {!autostart ? <Loading /> : (
              <div className="flex items-center justify-between gap-3">
                <Switch
                  checked={autostart.enabled}
                  onChange={toggleAutostart}
                  disabled={autostartBusy}
                  label={autostart.enabled ? "Activado" : "Desactivado"}
                />
                <span className="text-xs text-muted-fg">platform: {autostart.platform}</span>
              </div>
            )}
          </Section>

          <Section
            title="Atajo de teclado"
            description="Botón de acceso rápido global que muestra/oculta la ventana y arranca a escuchar."
          >
            {cfgLoading ? <Loading /> : (
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

          <Section title="Apariencia" description="Tema y posición de la ventana en la pantalla.">
            {cfgLoading ? <Loading /> : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Tema" hint="Reiniciá la ventana para aplicar.">
                  <UiSelect
                    value={theme}
                    onChange={(v) => patchKey("desktop.theme", v, `Tema: ${v}.`)}
                    options={THEME_OPTS}
                    disabled={busy}
                  />
                </Field>
                <Field label="Posición" hint='"izquierda" / "centro" / "derecha" del borde superior.'>
                  <UiSelect
                    value={position}
                    onChange={(v) => patchKey("desktop.position", v, `Posición: ${v}.`)}
                    options={POSITION_OPTS}
                    disabled={busy}
                  />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Activación + transcripción"
            description="El plugin del daemon procesa los mensajes. STT se configura en Voces."
          >
            {cfgLoading ? <Loading /> : (
              <div className="space-y-3">
                <Switch
                  checked={enabled}
                  onChange={(v) => patchKey("desktop.enabled", v, v ? "Desktop activado." : "Desktop desactivado.")}
                  disabled={busy}
                  label={enabled ? "Plugin activado (responde mensajes)" : "Plugin desactivado"}
                />
                <p className="text-xs text-muted-fg">
                  Motor de voz a texto: <Link to="/m/voice" className="font-medium text-fg underline underline-offset-2">Voces</Link>{" "}
                  (whisper local, idioma, modelo).
                </p>
              </div>
            )}
          </Section>
        </div>

        {/* ── RIGHT: last conversation preview ─────────────────────────── */}
        <div>
          <Section
            title="Última conversación"
            description="Lo último charlado con el agente desde la ventana flotante."
            action={
              <button
                type="button"
                onClick={() => mutateMsgs()}
                className="text-xs text-muted-fg underline-offset-2 hover:underline"
              >
                refrescar
              </button>
            }
          >
            <DesktopLastConversation
              messages={msgs || []}
              loading={msgsLoading}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Last-conversation panel ─────────────────────────────────────────────

function DesktopLastConversation({ messages, loading }: { messages: GlobalMessage[]; loading: boolean }) {
  // Group by exchange: a user turn + everything that follows until the next
  // user turn. Show the LAST exchange front-and-center, older ones beneath.
  const groups = useMemo(() => groupExchanges(messages), [messages]);

  if (loading) return <Loading />;
  if (!messages.length) return <Empty>Sin mensajes todavía. Mandale algo a la ventana de escritorio para que aparezca aquí.</Empty>;

  return (
    <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
      {groups.slice().reverse().map((g, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-card/40 p-3">
          {g.map((m, i) => <MessageLine key={i} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function MessageLine({ m }: { m: GlobalMessage }) {
  const isUser = m.direction === "in";
  const when = formatWhen(m.ts);
  return (
    <div className="py-1">
      <div className="flex items-baseline gap-2 text-[11px] text-muted-fg">
        <span className="font-semibold">{isUser ? "Vos" : "Roby"}</span>
        <span>{when}</span>
      </div>
      <div className={"mt-0.5 text-sm leading-snug whitespace-pre-wrap " + (isUser ? "text-muted-fg" : "text-fg")}>
        {(m.body || "").trim() || <span className="italic opacity-50">(vacío)</span>}
      </div>
    </div>
  );
}

function groupExchanges(messages: GlobalMessage[]): GlobalMessage[][] {
  // messages come oldest-first; chunk on user-direction boundaries.
  const out: GlobalMessage[][] = [];
  for (const m of messages) {
    if (m.direction === "in" || !out.length) out.push([m]);
    else out[out.length - 1].push(m);
  }
  return out;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    return same
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
