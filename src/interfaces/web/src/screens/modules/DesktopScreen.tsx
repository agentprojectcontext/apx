import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Section, Kbd, StatusDot } from "../../components/Section";
import { Button, Field, Input, Switch, Loading, Empty } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Desktop, fetchDesktopMessages, type GlobalMessage } from "../../lib/api/desktop";
import { t } from "../../i18n";

const DEFAULT_SHORTCUT = "CommandOrControl+G";
const positionOpts = () => [
  { value: "left",   label: t("modules_ui.desktop_pos_left") },
  { value: "center", label: t("modules_ui.desktop_pos_center") },
  { value: "right",  label: t("modules_ui.desktop_pos_right") },
];
const themeOpts = () => [
  { value: "light", label: t("modules_ui.desktop_theme_light") },
  { value: "dark",  label: t("modules_ui.desktop_theme_dark") },
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
      toast.success(t("modules_ui.desktop_shortcut_saved"));
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
      toast.success(v ? t("modules_ui.desktop_autostart_on") : t("modules_ui.desktop_autostart_off"));
    } catch (e) { toast.error((e as Error).message); }
    finally { setAutostartBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="screen-desktop">
      {/* ── Two-column layout: config on the left, last conversation on the right. ── */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ── LEFT: configuration + status ─────────────────────────────── */}
        <div className="space-y-6">
          <Section title={t("desktop_screen.status_title")} description={t("modules_ui.desktop_status_desc")}>
            {stLoading ? <Loading /> : (
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={running} />
                <span className="font-medium">{running ? t("modules_ui.desktop_running") : t("modules_ui.desktop_stopped")}</span>
                <button
                  type="button"
                  onClick={() => mutateStatus()}
                  className="ml-2 text-xs text-muted-fg underline-offset-2 hover:underline"
                >
                  {t("modules_ui.desktop_refresh")}
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-fg">
              {t("modules_ui.desktop_from_terminal")} <Kbd>apx desktop start</Kbd> · <Kbd>apx desktop --debug</Kbd>
            </p>
          </Section>

          <Section
            title={t("desktop_screen.autostart_title")}
            description={t("modules_ui.desktop_autostart_desc")}
          >
            {!autostart ? <Loading /> : (
              <div className="flex items-center justify-between gap-3">
                <Switch
                  checked={autostart.enabled}
                  onChange={toggleAutostart}
                  disabled={autostartBusy}
                  label={autostart.enabled ? t("common.enabled") : t("common.disabled")}
                />
                <span className="text-xs text-muted-fg">{t("modules_ui.desktop_platform", { platform: autostart.platform })}</span>
              </div>
            )}
          </Section>

          <Section
            title={t("desktop_screen.shortcut_title")}
            description={t("modules_ui.desktop_shortcut_desc")}
          >
            {cfgLoading ? <Loading /> : (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Field
                    label={t("modules_ui.desktop_accelerator")}
                    hint={t("modules_ui.desktop_accelerator_hint")}
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
                  {t("common.save")}
                </Button>
              </div>
            )}
          </Section>

          <Section title={t("desktop_screen.appearance_title")} description={t("modules_ui.desktop_appearance_desc")}>
            {cfgLoading ? <Loading /> : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("modules_ui.desktop_theme")} hint={t("modules_ui.desktop_restart_apply")}>
                  <UiSelect
                    value={theme}
                    onChange={(v) => patchKey("desktop.theme", v, t("modules_ui.desktop_theme_set", { value: v }))}
                    options={themeOpts()}
                    disabled={busy}
                  />
                </Field>
                <Field label={t("modules_ui.desktop_position")} hint={t("modules_ui.desktop_position_hint")}>
                  <UiSelect
                    value={position}
                    onChange={(v) => patchKey("desktop.position", v, t("modules_ui.desktop_position_set", { value: v }))}
                    options={positionOpts()}
                    disabled={busy}
                  />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title={t("desktop_screen.activation_title")}
            description={t("modules_ui.desktop_activation_desc")}
          >
            {cfgLoading ? <Loading /> : (
              <div className="space-y-3">
                <Switch
                  checked={enabled}
                  onChange={(v) => patchKey("desktop.enabled", v, v ? t("modules_ui.desktop_enabled_toast") : t("modules_ui.desktop_disabled_toast"))}
                  disabled={busy}
                  label={enabled ? t("modules_ui.desktop_plugin_on") : t("modules_ui.desktop_plugin_off")}
                />
                <p className="text-xs text-muted-fg">
                  {t("modules_ui.desktop_stt_engine")} <Link to="/m/voice" className="font-medium text-fg underline underline-offset-2">{t("nav.modules.voice")}</Link>{" "}
                  {t("modules_ui.desktop_stt_engine_suffix")}
                </p>
              </div>
            )}
          </Section>
        </div>

        {/* ── RIGHT: last conversation preview ─────────────────────────── */}
        <div>
          <Section
            title={t("desktop_screen.last_conv_title")}
            description={t("modules_ui.desktop_last_conv_desc")}
            action={
              <button
                type="button"
                onClick={() => mutateMsgs()}
                className="text-xs text-muted-fg underline-offset-2 hover:underline"
              >
                {t("modules_ui.desktop_refresh")}
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
  if (!messages.length) return <Empty>{t("modules_ui.desktop_no_messages")}</Empty>;

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
        <span className="font-semibold">{isUser ? t("modules_ui.desktop_you") : t("modules_ui.desktop_roby")}</span>
        <span>{when}</span>
      </div>
      <div className={"mt-0.5 text-sm leading-snug whitespace-pre-wrap " + (isUser ? "text-muted-fg" : "text-fg")}>
        {(m.body || "").trim() || <span className="italic opacity-50">{t("modules_ui.desktop_empty_msg")}</span>}
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
