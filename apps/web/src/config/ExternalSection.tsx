import type { EngineStatus } from "@apx/protocol";
import { Button, EmptyState, EngineIcon, IconButton, Icons, Menu, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadEngines } from "../data/engines.ts";
import { loadCatalog } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { EngineUsageSwitch } from "./EngineUsageSwitch.tsx";
import { ModelCatalog } from "./models/ModelCatalog.tsx";
import { SectionHead } from "./SectionHead.tsx";

type Look = { kind: MessageKey; login: MessageKey };

const LOOK: Record<string, Look> = {
  aider: { kind: "engine.kind.cli", login: "engine.login.oneshot" },
  antigravity: { kind: "engine.kind.cli", login: "engine.login.oneshot" },
  claude: { kind: "engine.kind.cli", login: "engine.login.claude" },
  codex: { kind: "engine.kind.cli", login: "engine.login.codex" },
};
/** Any Agent Client Protocol CLI (OpenCode, Qwen Code, Cursor…). */
const ACP_LOOK: Look = { kind: "engine.kind.acp", login: "engine.login.acp" };
const lookOf = (id: string): Look => LOOK[id] ?? ACP_LOOK;

/**
 * The CLIs of the owner's subscriptions (Claude Code and Codex always, ACP agents when installed): installed, signed
 * in, and the models each offers. They run only in their own sessions (sidebar › External sessions), never as an
 * agent's model or in the router (DECISIONS.md#d-043).
 */
export function ExternalSection() {
  const t = useT();
  const engines = useData((s) => s.engines);
  const load = useData((s) => s.enginesLoad);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void loadEngines();
    void loadCatalog();
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    await loadEngines(true);
    setRefreshing(false);
  };

  return (
    <>
      <SectionHead
        title={t("config.external")}
        lead={t("external.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            loading={refreshing}
            onClick={refresh}
          >
            {t("engines.recheck")}
          </Button>
        }
      />
      {load === "unavailable" ? (
        <EmptyState
          variant="dashed"
          icon={<Icons.Server />}
          title={t("engines.unavailable.title")}
          action={
            <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("engines.unavailable.body")}
        </EmptyState>
      ) : load !== "ready" && !engines.length ? (
        <div className="engines">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" height={112} />
          ))}
        </div>
      ) : (
        <div className="engines">
          {engines
            // ACP agents only when installed here.
            .filter(
              (e) =>
                e.id !== "native" &&
                (e.installed || e.id === "claude" || e.id === "codex" || e.auth === "on_invocation"),
            )
            .map((e) => (
              <EngineCard key={e.id} engine={e} />
            ))}
        </div>
      )}
      <ModelCatalog kind="harness" title={t("external.models")} lead={t("external.modelsLead")} />
    </>
  );
}

/** What to type in a terminal to sign a CLI in or out (APX never signs the owner's CLI out by itself). */
const SIGN: Record<string, { in: string; out: string }> = {
  claude: { in: "claude", out: "claude /logout" },
  codex: { in: "codex login", out: "codex logout" },
  "acp:cursor": { in: "cursor-agent login", out: "cursor-agent logout" },
};

function EngineCard({ engine: e }: { engine: EngineStatus }) {
  const t = useT();
  const look = lookOf(e.id);
  const hint = !e.installed ? t("engines.notInstalled") : !e.logged_in ? t(look.login) : undefined;
  const kind = t(look.kind);
  const detail = e.detail_code ? t(`engine.detail.${e.detail_code}`) : e.detail;
  const copy = (command: string) =>
    void navigator.clipboard.writeText(command).then(
      () => notify(t("engines.copied", { command }), "info"),
      () => {},
    );
  const sign = SIGN[e.id];
  return (
    <div className="engine">
      <div className="engine__top">
        <EngineIcon engine={e.id} tile size={36} />
        <div className="engine__titles">
          <div className="engine__name">
            {e.label}
            {e.version && <span className="engine__version">v{e.version.replace(/^v/, "")}</span>}
          </div>
          <div className="engine__kind">{detail ? `${kind} · ${detail}` : kind}</div>
        </div>
        <EngineUsageSwitch engine={e.id} />
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={[
            {
              label: t("engines.refreshModels"),
              icon: <Icons.RefreshCw size={14} />,
              onSelect: () => void loadCatalog(true),
            },
            ...(sign
              ? [
                  { type: "separator" as const },
                  {
                    label: t("engines.copySignIn"),
                    icon: <Icons.LogIn size={14} />,
                    onSelect: () => copy(sign.in),
                  },
                  {
                    label: t("engines.copySignOut"),
                    icon: <Icons.LogOut size={14} />,
                    onSelect: () => copy(sign.out),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <ol className="engine__steps" aria-label={t("engines.status")}>
        <Step done={e.installed} label={t("engines.installed")} />
        <Step
          done={e.auth === "on_invocation" ? e.installed : e.logged_in}
          label={t(e.auth === "on_invocation" ? "engine.authOnInvocation" : "engine.loggedIn")}
        />
      </ol>
      {hint && <p className="engine__hint">{hint}</p>}
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={done ? "engine__step is-done" : "engine__step"}>
      {done ? <Icons.CircleCheck size={14} /> : <Icons.CircleDashed size={14} />}
      {label}
    </li>
  );
}
