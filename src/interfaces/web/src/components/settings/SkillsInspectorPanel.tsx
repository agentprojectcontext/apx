import { useState } from "react";
import useSWR from "swr";
import { Sparkles, RefreshCw, Wand2 } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Badge, Switch } from "../ui";
import { useToast } from "../Toast";
import { Skills, type InspectTrace } from "../../lib/api/skills";

// Skill Inspector — per-turn skill RAG middleware. When ON, the static
// "available skills" slug-dump is removed from the agent's system prompt and a
// local RAG injects, per turn, only the skill(s) the user's message actually
// needs. This panel toggles the feature, tunes its thresholds, (re)builds the
// vector index, and offers a live dry-run so you can see what it would surface.
//
// Mirrors MemoryPanel (RAG embeddings): same Section/Field/Button idiom. Config
// persists under config.skills.inspector.* via the inspector PUT endpoint, so
// no separate global-config patch is needed.

// Numeric knobs with human labels + sane ranges. We keep them as plain number
// inputs (same idiom as the embeddings model fields) rather than sliders so the
// values are explicit and copy-pasteable.
const KNOBS: { key: keyof NumericKnobs; label: string; hint: string; step: number; min: number; max: number }[] = [
  { key: "load_threshold", label: "Umbral de carga", hint: "Similitud mínima para inyectar el CUERPO de la skill (alto = más estricto).", step: 0.01, min: 0, max: 1 },
  { key: "hint_threshold", label: "Umbral de sugerencia", hint: "Similitud mínima para solo SUGERIR la skill (que el agente la cargue si quiere).", step: 0.01, min: 0, max: 1 },
  { key: "margin", label: "Margen sobre el 2º", hint: "El top debe superar al segundo por este margen para cargar su cuerpo (evita empates flojos).", step: 0.01, min: 0, max: 1 },
  { key: "max_loaded", label: "Máx. cuerpos cargados", hint: "Cuántas skills se inyectan completas por turno.", step: 1, min: 0, max: 5 },
  { key: "max_hints", label: "Máx. sugerencias", hint: "Cuántas skills extra se nombran como sugerencia.", step: 1, min: 0, max: 8 },
  { key: "prompt_floor", label: "Largo mínimo del prompt", hint: "Mensajes más cortos que esto se ignoran (evita 'ok', 'hola').", step: 1, min: 0, max: 40 },
  { key: "body_char_cap", label: "Tope de chars del cuerpo", hint: "Recorta cuerpos de skill largos para no inflar el contexto.", step: 500, min: 500, max: 20000 },
];

type NumericKnobs = {
  load_threshold: number; hint_threshold: number; margin: number;
  max_loaded: number; max_hints: number; prompt_floor: number; body_char_cap: number;
};

export function SkillsInspectorPanel() {
  const toast = useToast();
  const { data, mutate, isLoading } = useSWR("/skills/inspector", () => Skills.inspector());
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState("");
  const [probeResult, setProbeResult] = useState<InspectTrace | null>(null);

  if (isLoading || !data) return <Loading />;

  const cfg = data.config;
  const idx = data.index;

  const apply = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await Skills.updateInspector(patch);
      await mutate();
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runIndex = async (force = false) => {
    setBusy(true);
    try {
      const r = await Skills.index({ force });
      toast.success(
        `Indexado con ${r.embedder} (dim ${r.dim}): +${r.changed.added} ~${r.changed.refreshed} -${r.changed.removed}.`,
      );
      await mutate();
    } catch (e) {
      toast.error(`Falló el index: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runProbe = async () => {
    if (!probe.trim()) return;
    setBusy(true);
    setProbeResult(null);
    try {
      const r = await Skills.inspect(probe.trim());
      setProbeResult(r.trace);
    } catch (e) {
      toast.error(`Falló el dry-run: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <Section
        title="Skill Inspector (RAG por turno)"
        description="Función experimental. Cuando está activa, el agente NO recibe la lista completa de skills en su prompt; en cada mensaje un RAG local decide qué skill(s) cargar — el cuerpo completo si hay match fuerte, una sugerencia si hay match medio, nada si no aplica. Se reevalúa cada turno: una skill que dejó de ser relevante desaparece del contexto."
      >
        <div className="space-y-4">
          <Field
            label="Activar inspector"
            hint="Apagado = comportamiento clásico (lista de slugs + sugerencia pasiva). Encendido = el RAG decide por turno."
          >
            <Switch
              checked={cfg.enabled}
              disabled={busy}
              onChange={(v) => apply({ enabled: v })}
              label={cfg.enabled ? "Encendido" : "Apagado"}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge tone={idx.count > 0 ? "success" : "warning"}>
              Índice: {idx.count} skills
            </Badge>
            <Badge tone="muted">{idx.embedder || "sin indexar"}</Badge>
            {idx.dim ? <Badge tone="muted">dim {idx.dim}</Badge> : null}
            {idx.updated_at ? (
              <span className="text-xs text-muted-foreground">
                actualizado {new Date(idx.updated_at).toLocaleString()}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="secondary" onClick={() => runIndex(false)} loading={busy}>
              <RefreshCw size={14} /> Reindexar
            </Button>
            <Button variant="secondary" onClick={() => runIndex(true)} loading={busy}>
              <RefreshCw size={14} /> Reindexar (forzado)
            </Button>
            <span className="text-xs text-muted-foreground">
              El embedder sale de Memoria (RAG). Local con Ollama, u offline si no hay proveedor.
            </span>
          </div>
        </div>
      </Section>

      <Section
        title="Umbrales y límites"
        description="Ajustá qué tan agresivo es el inspector. Subir los umbrales = menos falsos positivos pero más riesgo de perderse una skill; bajarlos = lo contrario."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {KNOBS.map((k) => (
            <Field key={k.key} label={k.label} hint={k.hint}>
              <Input
                type="number"
                step={k.step}
                min={k.min}
                max={k.max}
                defaultValue={String(cfg[k.key])}
                disabled={busy}
                onBlur={(ev) => {
                  const n = Number(ev.target.value);
                  if (Number.isFinite(n) && n !== cfg[k.key]) apply({ [k.key]: n });
                }}
                className="max-w-[12rem]"
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        title="Probar (dry-run)"
        description="Escribí un mensaje como lo haría un usuario y mirá qué skills cargaría/sugeriría el inspector — sin llamar al modelo. Fuerza el inspector activo aunque esté apagado arriba."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={probe}
              placeholder="ej: necesito crear un video promocional con voz en off"
              disabled={busy}
              onChange={(ev) => setProbe(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") runProbe(); }}
              className="max-w-xl flex-1"
            />
            <Button variant="primary" onClick={runProbe} loading={busy}>
              <Wand2 size={14} /> Probar
            </Button>
          </div>

          {probeResult && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Sparkles size={14} className="text-muted-foreground" />
                <span className="text-muted-foreground">{probeResult.embedder || "—"}</span>
                {probeResult.jit ? <Badge tone="warning">JIT (índice vacío)</Badge> : null}
                {probeResult.reason && !probeResult.loaded?.length && !probeResult.hinted?.length ? (
                  <Badge tone="muted">{probeResult.reason}</Badge>
                ) : null}
              </div>

              {probeResult.loaded?.length ? (
                <div className="mb-1">
                  <span className="text-muted-foreground">Cargadas: </span>
                  {probeResult.loaded.map((s) => (
                    <Badge key={s} tone="success" className="mr-1">{s}</Badge>
                  ))}
                </div>
              ) : null}

              {probeResult.hinted?.length ? (
                <div className="mb-1">
                  <span className="text-muted-foreground">Sugeridas: </span>
                  {probeResult.hinted.map((s) => (
                    <Badge key={s} tone="info" className="mr-1">{s}</Badge>
                  ))}
                </div>
              ) : null}

              {probeResult.scored?.length ? (
                <div className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                  {probeResult.scored.map((s) => (
                    <div key={s.slug}>{s.sim.toFixed(3)}  {s.slug}</div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
