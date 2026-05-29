import { useState } from "react";
import { Section } from "../Section";
import { Button, Field, Input } from "../ui";
import { useTheme } from "../../hooks/useTheme";
import { useToast } from "../Toast";
import { getToken, setToken } from "../../lib/api";
import { STORAGE } from "../../constants";
import { t } from "../../i18n";

export function AppearancePanel() {
  const toast = useToast();
  const { theme, set } = useTheme();
  const [draftToken, setDraftToken] = useState("");

  const save = () => {
    const v = draftToken.trim();
    if (!v) return;
    setToken(v);
    try { localStorage.setItem(STORAGE.token, v); } catch { /* quota */ }
    setDraftToken("");
    toast.success(t("settings.token_saved"));
  };

  return (
    <div className="space-y-6">
      <Section title={t("settings.appearance")}>
        <div className="flex items-center gap-2">
          <Button variant={theme === "light" ? "primary" : "secondary"} onClick={() => set("light")}>{t("settings.light_mode")}</Button>
          <Button variant={theme === "dark"  ? "primary" : "secondary"} onClick={() => set("dark")}>{t("settings.dark_mode")}</Button>
        </div>
      </Section>

      <Section title={t("settings.token")} description={t("settings.token_sub")}>
        <Field label="Bearer">
          <Input
            type="password"
            placeholder={getToken() ? t("settings.token_active") : t("settings.token_paste")}
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            className="font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
        </Field>
        <div className="mt-2">
          <Button variant="primary" onClick={save}>{t("common.save")}</Button>
        </div>
      </Section>
    </div>
  );
}
