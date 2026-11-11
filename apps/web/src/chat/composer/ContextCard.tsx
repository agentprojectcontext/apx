import type { RunContext } from "@apx/protocol";
import { Button, Icons, Meter, type MeterTone } from "@apx/ui";
import { useEffect, useState } from "react";
import { formatNumber, formatSeconds } from "../../common/format.ts";
import { compactThread } from "../../data/actions.ts";
import { client } from "../../data/client.ts";
import { baseRef } from "../../data/models.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { COMPACT_AT_SHARE, type ContextCardProps, type ContextKind, contextParts } from "./context.ts";

const TONE: Record<ContextKind, MeterTone> = {
  system: "info",
  memory: "brand",
  tools: "violet",
  skills: "warning",
  messages: "muted",
};

const LABEL: Record<ContextKind, MessageKey> = {
  system: "ctx.part.system",
  memory: "ctx.part.memory",
  tools: "ctx.part.tools",
  skills: "ctx.part.skills",
  messages: "ctx.part.messages",
};

// What a run carried does not change: asked once per run while the panel is open.
const carried = new Map<string, Promise<RunContext["sizes"] | undefined>>();
function sizesOf(run: string): Promise<RunContext["sizes"] | undefined> {
  let hit = carried.get(run);
  if (!hit) {
    hit = client.call("runs.context", { run }).then(
      (c) => c.sizes,
      () => undefined,
    );
    carried.set(run, hit);
  }
  return hit;
}

/** "96.8K" / "96,8 mil": the language's own short form. */
const short = (n: number) => formatNumber(n, { notation: "compact", maximumFractionDigits: 1 });

/** What fills the chat's context, by kind, and what is left; compact it, or see what the chat spent. */
export function ContextCard(props: ContextCardProps & { onDone: () => void }) {
  const { context, run } = props;
  const t = useT();
  const [sizes, setSizes] = useState<RunContext["sizes"]>();
  const [more, setMore] = useState(!context);
  useEffect(() => {
    if (!run) return;
    let live = true;
    void sizesOf(run).then((s) => live && setSizes(s));
    return () => {
      live = false;
    };
  }, [run]);

  const full = context?.window;
  // Until what the run carried arrives (or when it is no longer kept), the bar is one amount.
  const parts = context
    ? sizes
      ? contextParts(sizes, context.used)
      : [{ kind: "messages" as const, tokens: context.used }]
    : [];
  const percent = (n: number) => formatNumber(n, { style: "percent", maximumFractionDigits: 0 });
  const canCompact = Boolean(props.thread) && !props.engine && Boolean(context);
  return (
    <div className="ctxcard">
      <div className="ctxcard__body">
        <div className="ctxcard__head">
          <span className="ctxcard__title">{t("ctx.title")}</span>
          {context && full ? (
            <span className="ctxcard__full">{t("ctx.full", { share: percent(Math.min(1, context.used / full)) })}</span>
          ) : null}
        </div>
        {context && (
          <>
            {/* Without the model's window the bar shows what the context is made of. */}
            {(full || sizes) && (
              <div className="ctxcard__bar">
                <Meter
                  label={t("ctx.title")}
                  max={full ?? context.used}
                  valueText={
                    full
                      ? t("ctx.used", { used: short(context.used), window: short(full) })
                      : t("ctx.usedOnly", { used: short(context.used) })
                  }
                  segments={parts.map((p) => ({ value: p.tokens, tone: TONE[p.kind] }))}
                />
                {full && !props.engine && (
                  <span className="ctxcard__mark" style={{ left: `${COMPACT_AT_SHARE * 100}%` }} aria-hidden="true" />
                )}
              </div>
            )}
            <span className="ctxcard__note">
              {full
                ? t("ctx.used", { used: short(context.used), window: short(full) })
                : t("ctx.usedOnly", { used: short(context.used) })}
            </span>
          </>
        )}
        {context && sizes && (
          <ul className="ctxcard__parts">
            {parts.map((p) => (
              <li key={p.kind} className="ctxcard__part">
                <span className={`ctxcard__dot apx-meter__fill--${TONE[p.kind]}`} />
                <span className="ctxcard__name">{t(LABEL[p.kind])}</span>
                <span className="ctxcard__value">{short(p.tokens)}</span>
              </li>
            ))}
            {full ? (
              <li className="ctxcard__part">
                <span className="ctxcard__dot is-free" />
                <span className="ctxcard__name">{t("ctx.part.free")}</span>
                <span className="ctxcard__value">{short(Math.max(0, full - context.used))}</span>
              </li>
            ) : null}
          </ul>
        )}
        {context && full && !props.engine ? (
          <span className="ctxcard__note">{t("ctx.autoCompact", { share: percent(COMPACT_AT_SHARE) })}</span>
        ) : null}
        {more && <Spent {...props} />}
      </div>
      {(canCompact || context) && (
        <div className="ctxcard__foot">
          {canCompact && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icons.Layers size={14} />}
              onClick={() => {
                props.onDone();
                if (props.thread) void compactThread(props.thread);
              }}
            >
              {t("ctx.compact")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={more ? <Icons.ChevronUp size={14} /> : <Icons.Activity size={14} />}
            onClick={() => setMore((m) => !m)}
          >
            {t(more ? "ctx.less" : "ctx.more")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** What the chat has spent over all its runs, as the core counts it. */
function Spent({ totals, model }: ContextCardProps) {
  const t = useT();
  const engine = model?.split("/")[0] ?? "";
  // Claude Code, Codex and ACP agents run on the owner's subscription; our own loop pays a provider per token.
  const included = engine === "claude" || engine === "codex" || engine.startsWith("acp:");
  const rows: [string, string][] = [
    [t("usage.model"), model ? baseRef(model) : "—"],
    [t("usage.billing"), model ? t(included ? "usage.billing.included" : "usage.billing.metered") : "—"],
    [
      t("usage.runs"),
      totals ? `${formatNumber(totals.runs)}${totals.failed ? t("usage.runsFailed", { n: totals.failed }) : ""}` : "…",
    ],
    [t("usage.agentTime"), totals ? formatSeconds(totals.seconds) : "…"],
    [
      t("usage.tokens"),
      !totals
        ? "…"
        : totals.input + totals.output
          ? t("usage.tokensValue", { input: formatNumber(totals.input), output: formatNumber(totals.output) })
          : t("usage.noTokens"),
    ],
  ];
  if (totals?.cached)
    rows.push([
      t("usage.cached"),
      t("usage.cachedValue", { cached: formatNumber(totals.cached), input: formatNumber(totals.input) }),
    ]);
  return (
    <dl className="ctxcard__spent">
      {rows.map(([key, value]) => (
        <div key={key} className="ctxcard__row">
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
