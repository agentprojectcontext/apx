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
    if (!n) { toast.error("Nombre requerido."); return; }
    if (BUILT_IN.has(n)) { toast.error(`"${n}" es un rol built-in.`); return; }
    setBusy(true);
    try {
      const tools = allTools ? "*" as const : toolsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      await Telegram.roles.set(n, tools);
      toast.success(`Rol "${n}" guardado.`);
      setName(""); setToolsRaw(""); setAllTools(false);
      mutate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (n: string) => {
    if (!confirm(`¿Borrar el rol "${n}"?`)) return;
    try { await Telegram.roles.remove(n); toast.success("Rol eliminado."); mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const roleEntries = Object.entries(roles);

  return (
    <Section
      title="Roles"
      description="Cada rol define qué herramientas del super-agent puede usar quien lo tenga asignado. 'owner' siempre = todas; 'guest' siempre = ninguna (solo chat)."
    >
      {isLoading && <Loading />}
      {roleEntries.length === 0 && !isLoading && <Empty>No hay roles definidos.</Empty>}
      {roleEntries.length > 0 && (
        <ul className="space-y-2 text-sm">
          {roleEntries.map(([n, def]) => {
            const builtIn = BUILT_IN.has(n);
            const toolsLabel = def?.tools === "*"
              ? "todas las herramientas"
              : Array.isArray(def?.tools) && def.tools.length > 0
                ? def.tools.join(", ")
                : "ninguna herramienta";
            return (
              <li key={n} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{n}</span>
                    {builtIn && <Badge tone="info">built-in</Badge>}
                  </div>
                  {!builtIn && (
                    <Button size="sm" variant="destructive" onClick={() => remove(n)}>Borrar</Button>
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
          <Plus size={14} /> Nuevo rol o reemplazar uno custom
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="editor" />
          </Field>
          <Field
            label="Tools (separadas por coma)"
            hint="Vacío = ninguna. Ejemplos: call_agent, list_tasks, create_task."
          >
            <Input
              value={toolsRaw}
              onChange={(e) => setToolsRaw(e.target.value)}
              disabled={allTools}
              placeholder="call_agent, list_tasks"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Switch checked={allTools} onChange={setAllTools} label="Acceso total (todas las tools)" />
          <Button variant="primary" loading={busy} onClick={submit}>Guardar rol</Button>
        </div>
      </div>
    </Section>
  );
}
