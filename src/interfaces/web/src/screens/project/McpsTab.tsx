import { useState } from "react";
import useSWR from "swr";
import { Plus, Trash2 } from "lucide-react";
import { Mcps } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";

export function McpsTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/mcps`, () => Mcps.list(pid));
  const conflicts = useSWR(`/projects/${pid}/mcps/check`, () => Mcps.check(pid));
  const [open, setOpen] = useState(false);

  const remove = async (name: string, scope: any) => {
    if (!confirm(`Borrar MCP ${name} de scope ${scope}?`)) return;
    try { await Mcps.remove(pid, name, scope); toast.success("eliminado"); list.mutate(); }
    catch (e: any) { toast.error(e?.message || "delete falló"); }
  };

  return (
    <Section
      title="MCP servers"
      description="3 scopes: runtime > shared > global. Conflictos arriba si los hay."
      action={<Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={14} /> MCP</Button>}
    >
      {conflicts.data?.conflicts?.length ? (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          ⚠ Conflictos: {conflicts.data.conflicts.map((c: any) => c.name).join(", ")}
        </div>
      ) : null}

      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>Sin MCPs configurados.</Empty>}

      <ul className="space-y-2 text-sm">
        {(list.data || []).map((m) => (
          <li key={`${m.source}-${m.name}`} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="font-medium">{m.name}</span>
            <Badge tone="info">{m.source}</Badge>
            <span className="ml-auto text-xs text-muted-fg">
              {m.transport} · {m.enabled === false ? "disabled" : "enabled"}
            </span>
            <Button size="sm" variant="destructive" onClick={() => remove(m.name, m.source)}>
              <Trash2 size={13} />
            </Button>
          </li>
        ))}
      </ul>

      <CreateMcpDialog open={open} onClose={() => setOpen(false)} pid={pid} onCreated={() => { setOpen(false); list.mutate(); }} />
    </Section>
  );
}

function CreateMcpDialog({
  open,
  onClose,
  pid,
  onCreated,
}: { open: boolean; onClose: () => void; pid: string; onCreated: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"shared" | "runtime" | "global">("shared");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState("");
  const [enabled, setEnabled] = useState(true);

  const submit = async () => {
    if (!name) { toast.error("name requerido"); return; }
    setBusy(true);
    try {
      let parsedEnv: Record<string, string> | undefined;
      if (env.trim()) {
        try { parsedEnv = JSON.parse(env); }
        catch { toast.error("env debe ser JSON válido"); setBusy(false); return; }
      }
      const body =
        transport === "stdio"
          ? { name, command, args: args ? args.split(/\s+/) : undefined, env: parsedEnv, enabled }
          : { name, url, enabled };
      await Mcps.add(pid, scope, body);
      toast.success("MCP agregado.");
      setName(""); setCommand(""); setArgs(""); setUrl(""); setEnv("");
      onCreated();
    } catch (e: any) { toast.error(e?.message || "add falló"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nuevo MCP"
      description="POST /projects/:pid/mcps?scope=…"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Agregar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="scope">
            <UiSelect
              value={scope}
              onChange={(v) => setScope(v as any)}
              options={[
                { value: "shared", label: "shared", description: ".apc/mcps.json" },
                { value: "runtime", label: "runtime", description: "~/.apx, con secrets" },
                { value: "global", label: "global", description: "estilo ~/.claude/mcp.json" },
              ]}
            />
          </Field>
          <Field label="transport">
            <UiSelect
              value={transport}
              onChange={(v) => setTransport(v as any)}
              options={[
                { value: "stdio", label: "stdio", description: "command" },
                { value: "http", label: "http", description: "url" },
              ]}
            />
          </Field>
        </div>
        <Field label="name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" /></Field>
        {transport === "stdio" ? (
          <>
            <Field label="command"><Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></Field>
            <Field label="args" hint="space-separated"><Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" /></Field>
            <Field label="env (JSON, opcional)" hint='{"FOO":"bar"}'>
              <Textarea rows={3} className="font-mono text-xs" value={env} onChange={(e) => setEnv(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="url"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" /></Field>
        )}
        <Switch checked={enabled} onChange={setEnabled} label="Habilitado" />
      </div>
    </Dialog>
  );
}
