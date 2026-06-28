import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Section } from "../Section";
import { Button, Field, Switch, Loading } from "../ui";
import { UiSelect } from "../UiSelect";
import { ShortcutInput } from "../ShortcutInput";
import { DesktopStatusCard } from "../desktop/DesktopStatusCard";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Desktop } from "../../lib/api/desktop";
import { t } from "../../i18n";

const DEFAULT_SHORTCUT = "CommandOrControl+G";
const positionOpts = () => [
  { value: "left",   label: t("modules_ui.desktop_pos_left") },
  { value: "center", label: t("modules_ui.desktop_pos_center") },
  { value: "right",  label: t("modules_ui.desktop_pos_right") },
];
const themeOpts = () => [
  { value: "system", label: t("modules_ui.desktop_theme_system") },
  { value: "light",  label: t("modules_ui.desktop_theme_light") },
  { value: "dark",   label: t("modules_ui.desktop_theme_dark") },
];

// Desktop configuration — the persisted settings for the floating voice window
// (autostart, global shortcut, appearance, activation). Lives in Settings; the
// Desktop rail module only shows live status + the last conversation. The window
// itself is an Electron process spawned by `apx desktop start`, so this just
// edits config the daemon persists and toggles per-user autostart.
export function DesktopSettingsPanel() {
  const toast = useToast();
  const { config, isLoading: cfgLoading, patch } = useGlobalConfig();

  // config.desktop isn't on the typed GlobalConfig — read it off a local view.
  const cfgView = config as unknown as {
    desktop?: {
      shortcut?: string; enabled?: boolean;
      theme?: "light" | "dark" | "system";
      position?: "left" | "center" | "right";
    };
    overlay?: { shortcut?: string }; // legacy fallback
  };
  const savedShortcut = cfgView.desktop?.shortcut || cfgView.overlay?.shortcut || DEFAULT_SHORTCUT;
  const enabled  = cfgView.desktop?.enabled !== false;
  // Default to "system" so the window follows the OS appearance until the
  // user explicitly pins light/dark.
  const theme    = cfgView.desktop?.theme    || "system";
  const position = cfgView.desktop?.position || "right";

  const { data: autostart, mutate: mutateAutostart } = useSWR(
    "/desktop/autostart",
    () => Desktop.autostartGet(),
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
    <div className="space-y-6" data-testid="settings-desktop">
      <DesktopStatusCard />

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
          <Field
            label={t("modules_ui.desktop_accelerator")}
            hint={t("modules_ui.desktop_accelerator_hint")}
          >
            <ShortcutInput
              value={shortcut}
              onChange={setShortcut}
              disabled={busy}
              trailing={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveShortcut}
                  loading={busy}
                  disabled={!shortcut.trim() || shortcut.trim() === savedShortcut}
                >
                  {t("common.save")}
                </Button>
              }
            />
          </Field>
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
              {t("modules_ui.desktop_stt_engine")} <Link to="/settings/voice" className="font-medium text-fg underline underline-offset-2">{t("nav.modules.voice")}</Link>{" "}
              {t("modules_ui.desktop_stt_engine_suffix")}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
