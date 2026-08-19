import { useState } from "react";
import { Check, Server } from "lucide-react";
import { Agents } from "../../lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Empty, Loading, Spinner } from "../ui";
import { useToast } from "../Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { INHERIT_MODEL, isInheritedModel, splitModelId, useModelCatalog } from "./modelCatalog";

// The agent's forced model, shown as a compact badge that doubles as its own
// editor: click it and a popover picks provider → model from what this install
// has configured. It lives in the card's action row (beside View/Chat), so it
// only gets the leftover width and truncates ("anthropic:claude-op…") instead
// of stretching the card.
export function AgentModelBadge({
  pid, slug, model, onSaved, className,
}: {
  pid: string;
  slug: string;
  model?: string | null;
  onSaved?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const inherited = isInheritedModel(model);

  const pick = async (value: string) => {
    if (value === model || (value === INHERIT_MODEL && inherited)) { setOpen(false); return; }
    setSaving(true);
    try {
      await Agents.update(pid, slug, { model: value });
      onSaved?.();
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("agents_ui.model_change_tip")}
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] transition-colors hover:border-muted-fg/60 hover:text-foreground",
          inherited ? "text-muted-fg" : "text-sky-800 dark:text-sky-400",
          className,
        )}
      >
        {saving ? <Spinner size={10} /> : <Server className="size-2.5 shrink-0" />}
        <span className="truncate font-mono">
          {inherited ? INHERIT_MODEL : model}
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-2">
        <ModelPickerCard current={model || ""} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}

// Rendered only once the popover opens (Base UI mounts the portal on demand),
// so the provider catalog is fetched on first click, not per card painted.
function ModelPickerCard({ current, onPick }: { current: string; onPick: (v: string) => void }) {
  const { providers, loading } = useModelCatalog();
  // Which provider's models are listed. Null = follow the stored model's
  // provider; derived instead of stateful so the async catalog needs no effect.
  const [picked, setPicked] = useState<string | null>(null);
  const wanted = picked ?? splitModelId(current).provider;
  const active = providers.find((p) => p.slug === wanted) ?? providers[0];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-foreground">{t("agents_ui.model_change_title")}</span>

      {loading && <Loading />}
      {!loading && providers.length === 0 && (
        <Empty icon={Server}>{t("agents_ui.model_no_providers")}</Empty>
      )}

      {!loading && providers.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1">
            {providers.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => setPicked(p.slug)}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
                  p.slug === active?.slug
                    ? "border-transparent bg-accent text-accent-fg"
                    : "border-border text-muted-fg hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          <ul className="max-h-52 overflow-y-auto">
            <li>
              <ModelRow
                label={t("agents_ui.model_inherit_option")}
                selected={isInheritedModel(current)}
                onClick={() => onPick(INHERIT_MODEL)}
              />
            </li>
            {active?.models.map((m) => {
              const id = `${active.slug}:${m}`;
              return (
                <li key={id}>
                  <ModelRow
                    label={m}
                    hint={m === active.defaultModel ? t("agents_ui.model_provider_default") : undefined}
                    mono
                    selected={current === id}
                    onClick={() => onPick(id)}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ModelRow({
  label, hint, mono, selected, onClick,
}: {
  label: string;
  hint?: string;
  mono?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-fg",
        selected && "bg-accent/50",
      )}
    >
      <span className={cn("truncate", mono && "font-mono")}>{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-muted-fg">{hint}</span>}
      {selected && <Check className="size-3 shrink-0" />}
    </button>
  );
}
