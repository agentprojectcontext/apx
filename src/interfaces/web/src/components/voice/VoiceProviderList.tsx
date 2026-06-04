import { CheckCircle2, ChevronDown, ChevronUp, Circle, Settings2 } from "lucide-react";
import { Badge, Button, Switch } from "../ui";
import { StatusDot } from "../Section";
import { cn } from "../../lib/cn";
import {
  TTS_PROVIDER_META,
  type TtsEngineInfo,
  type TtsMode,
} from "../../lib/api/voice";

// TTS engine selector. Two modes:
//   chain  — ordered fallback router; toggles enable/disable engines and the
//            arrows reorder the chain.
//   single — use exactly one default engine (radio); the rest stay configured
//            for explicit overrides (e.g. the tester).
// Availability/configured/enabled all come from the daemon (/tts/providers).

interface Props {
  engines: TtsEngineInfo[];
  order: string[];            // effective chain order from the daemon
  mode: TtsMode;
  configuredProvider: string; // single-mode default engine id ("auto" = none)
  onSetMode: (mode: TtsMode) => void;
  onSetDefault: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onReorder: (nextOrder: string[]) => void;
  onConfigure: (id: string) => void;
  busy?: boolean;
}

export function VoiceProviderList({
  engines,
  order,
  mode,
  configuredProvider,
  onSetMode,
  onSetDefault,
  onToggleEnabled,
  onReorder,
  onConfigure,
  busy,
}: Props) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  // Render in the daemon's effective order, then any extras it didn't list.
  const ids = [
    ...order.filter((id) => byId.has(id)),
    ...engines.map((e) => e.id).filter((id) => !order.includes(id)),
  ];
  const isChain = mode === "chain";

  const move = (id: string, dir: -1 | 1) => {
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    onReorder(reordered);
  };

  return (
    <div className="space-y-3">
      {/* Mode switch: router chain vs single default. */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Modo de selección</div>
            <div className="text-xs text-muted-fg">
              {isChain
                ? "Cadena con fallback: usa el primer motor disponible según el orden de abajo."
                : "Solo el motor por defecto: usa siempre el elegido; los demás quedan configurados para otras cosas."}
            </div>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border" role="group">
            <button
              type="button"
              onClick={() => onSetMode("chain")}
              disabled={busy}
              data-testid="voice-mode-chain"
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                isChain ? "bg-emerald-500/15 text-emerald-300" : "text-muted-fg hover:text-fg",
              )}
            >
              Cadena (router)
            </button>
            <button
              type="button"
              onClick={() => onSetMode("single")}
              disabled={busy}
              data-testid="voice-mode-single"
              className={cn(
                "border-l border-border px-3 py-1.5 text-xs font-medium transition-colors",
                !isChain ? "bg-emerald-500/15 text-emerald-300" : "text-muted-fg hover:text-fg",
              )}
            >
              Solo el motor por defecto
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {ids.map((id, idx) => {
          const e = byId.get(id)!;
          const meta = TTS_PROVIDER_META[id] || { name: id, note: "" };
          const isDefault = !isChain && configuredProvider === id;
          // mock is the guaranteed fallback — always on, can't be turned off.
          const lockedOn = id === "mock";
          return (
            <div
              key={id}
              data-testid={`voice-provider-${id}`}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                isDefault ? "border-emerald-500/50 bg-emerald-500/10" : "border-border",
                isChain && !lockedOn && !e.enabled && "opacity-60",
              )}
            >
              {isChain && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    disabled={busy || idx === 0}
                    aria-label="Subir"
                    data-testid={`voice-provider-${id}-up`}
                    className="text-muted-fg hover:text-fg disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    disabled={busy || idx === ids.length - 1}
                    aria-label="Bajar"
                    data-testid={`voice-provider-${id}-down`}
                    className="text-muted-fg hover:text-fg disabled:opacity-30"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
              )}

              <StatusDot ok={e.available ? true : e.configured ? false : null} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{meta.name}</span>
                  {meta.local && <Badge tone="info">local</Badge>}
                  {e.available ? (
                    <Badge tone="success">disponible</Badge>
                  ) : e.configured ? (
                    <Badge tone="warning">configurado, no disponible</Badge>
                  ) : (
                    <Badge tone="muted">sin configurar</Badge>
                  )}
                  {isDefault && <Badge tone="success">por defecto</Badge>}
                </div>
                <div className="truncate text-xs text-muted-fg">{meta.note}</div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isChain ? (
                  <Switch
                    checked={lockedOn ? true : e.enabled}
                    onChange={(v) => onToggleEnabled(id, v)}
                    disabled={busy || lockedOn}
                  />
                ) : (
                  !isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSetDefault(id)}
                      disabled={busy}
                      data-testid={`voice-provider-${id}-default`}
                    >
                      <Circle className="size-3.5" /> Usar por defecto
                    </Button>
                  )
                )}
                {isDefault && <CheckCircle2 className="size-4 text-emerald-400" />}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onConfigure(id)}
                  data-testid={`voice-provider-${id}-config`}
                >
                  <Settings2 className="size-3.5" /> Configurar
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
