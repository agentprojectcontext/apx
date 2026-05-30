// Manage role → {tools} definitions used to gate which super-agent tools a
// Telegram sender can invoke. owner / guest are built-in; custom roles are
// defined here and assigned per-contact in the Contactos panel.

import { useState } from "react";
import { Plus } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Empty, Field, Input, Loading, Switch } from "../ui";
import { useToast } from "../Toast";
import { useTelegramContacts } from "../../hooks/useTelegram";
import { Telegram } from "../../lib/api";
import { t } from "../../i18n";

const BUILT_IN = new Set(["owner", "guest"]);

export function TelegramRolesPanel() {
  const toast = useToast();
  const { roles, mutate, isLoading } = useTelegramContacts();
  const [name, setName] = useState("");
  const [toolsRaw, setToolsRaw] = useState("");
  const [allTools, setAllTools] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n) { toast.error(t("telegram_roles.name_required")); return; }
    if (BUILT_IN.has(n)) { toast.error(t("telegram_roles.builtin_error", { name: n })); return; }
    setBusy(true);
    try {
      const tools = allTools ? "*" as const : toolsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      await Telegram.roles.set(n, tools);
      toast.success(t("telegram_roles.saved", { name: n }));
      setName(""); setToolsRaw(""); setAllTools(false);
      mutate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (n: string) => {
    if (!confirm(t("telegram_roles.delete_confirm", { name: n }))) return;
    try { await Telegram.roles.remove(n); toast.success(t("telegram_roles.removed")); mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const roleEntries = Object.entries(roles);

  return (
    <Section
      title={t("telegram_roles.title")}
      description={t("telegram_roles.desc")}
    >
      {isLoading && <Loading />}
      {roleEntries.length === 0 && !isLoading && <Empty>{t("telegram_roles.empty")}</Empty>}
      {roleEntries.length > 0 && (
        <ul className="space-y-2 text-sm">
          {roleEntries.map(([n, def]) => {
            const builtIn = BUILT_IN.has(n);
            const toolsLabel = def?.tools === "*"
              ? t("telegram_roles.tools_all")
              : Array.isArray(def?.tools) && def.tools.length > 0
                ? def.tools.join(", ")
                : t("telegram_roles.tools_none");
            return (
              <li key={n} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{n}</span>
                    {builtIn && <Badge tone="info">{t("telegram_roles.builtin")}</Badge>}
                  </div>
                  {!builtIn && (
                    <Button size="sm" variant="destructive" onClick={() => remove(n)}>{t("telegram_roles.delete_btn")}</Button>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-fg">tools: {toolsLabel}</div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 space-y-3 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plus size={14} /> {t("telegram_roles.new_title")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("telegram_roles.name_label")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("telegram_roles.name_ph")} />
          </Field>
          <Field
            label={t("telegram_roles.tools_label")}
            hint={t("telegram_roles.tools_hint")}
          >
            <Input
              value={toolsRaw}
              onChange={(e) => setToolsRaw(e.target.value)}
              disabled={allTools}
              placeholder={t("telegram_roles.tools_ph")}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Switch checked={allTools} onChange={setAllTools} label={t("telegram_roles.full_access")} />
          <Button variant="primary" loading={busy} onClick={submit}>{t("telegram_roles.save_btn")}</Button>
        </div>
      </div>
    </Section>
  );
}
