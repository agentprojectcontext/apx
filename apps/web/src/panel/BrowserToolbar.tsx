import type { TabInfo } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserControl, browserHistory, browserNavigate, browserOpen } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { t as tr, useT } from "../i18n/index.ts";
import { nav } from "../shell/nav.ts";

/** "example.com" → "https://example.com"; anything that is not http(s) is refused. */
function normalizeUrl(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Back · reload · address pill · who drives the tab. `tab` undefined = typing the URL of a new tab. */
export function BrowserToolbar({ tab, onOpened }: { tab: TabInfo | undefined; onOpened: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isNew = tab == null;
  const draft = editing ?? (isNew ? "" : undefined);

  const submit = async () => {
    const url = normalizeUrl(draft ?? "");
    if (!url) return notify(tr("browser.badUrl"));
    setEditing(undefined);
    if (tab) return void browserNavigate(tab.tab, url);
    const id = await browserOpen(url);
    if (id) nav.set({ browserTab: id });
    onOpened();
  };
  const control = (mode: "user" | "idle") => async () => {
    if (!tab) return;
    setBusy(true);
    await browserControl(tab.tab, mode);
    setBusy(false);
  };

  const c = tab?.control;
  return (
    <div className="btoolbar">
      <IconButton
        size="sm"
        label={t("browser.back")}
        icon={<Icons.ArrowLeft size={15} />}
        disabled={!tab}
        onClick={() => tab && void browserHistory(tab.tab, "back")}
      />
      <IconButton
        size="sm"
        label={t("browser.reload")}
        icon={<Icons.RotateCcw size={14} />}
        disabled={!tab}
        onClick={() => tab && void browserHistory(tab.tab, "reload")}
      />
      {draft != null ? (
        <input
          className="btoolbar__input"
          // biome-ignore lint/a11y/noAutofocus: the field opens on an explicit click
          autoFocus
          aria-label={t("browser.address")}
          placeholder={t("browser.typeUrl")}
          value={draft}
          onChange={(e) => setEditing(e.currentTarget.value)}
          onBlur={() => !isNew && setEditing(undefined)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") isNew ? onOpened() : setEditing(undefined);
          }}
        />
      ) : (
        <button
          type="button"
          className={c?.kind === "agent" ? "btoolbar__url is-compact" : "btoolbar__url"}
          title={tab?.url}
          onClick={() => setEditing(tab?.url ?? "")}
        >
          {tab?.url.startsWith("https://") ? <Icons.Lock size={12} /> : <Icons.Globe size={12} />}
          <span className="btoolbar__urltext">{tab ? hostPath(tab.url) : ""}</span>
        </button>
      )}
      {c?.kind === "agent" && draft == null && (
        <>
          <span className="btoolbar__status is-agent">
            <span className="btoolbar__dot" />
            <span className="btoolbar__statustext">
              <AgentUsing id={c.by} />
            </span>
          </span>
          <Button size="sm" className="btoolbar__btn" onClick={control("user")} loading={busy}>
            {t("browser.takeControl")}
          </Button>
        </>
      )}
      {c?.kind === "idle" && draft == null && (
        <span className="btoolbar__status">
          <span className="btoolbar__statustext">{t("browser.free")}</span>
        </span>
      )}
      {c?.kind === "user" && draft == null && (
        <>
          <span className="btoolbar__status">
            <span className="btoolbar__statustext">{t("browser.youControl")}</span>
          </span>
          <Button size="sm" variant="secondary" className="btoolbar__btn" onClick={control("idle")} loading={busy}>
            {t("browser.giveBack")}
          </Button>
        </>
      )}
    </div>
  );
}

/** The agent handed the tab to the human (login, 2FA, captcha): say why, and "Done" when finished. */
export function HandoffBar({ tab }: { tab: TabInfo }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (tab.control.kind !== "handoff") return null;
  const { by, reason } = tab.control;
  return (
    <div className="handoff" role="status">
      <Icons.Hand size={14} />
      <span className="handoff__text">
        <b>
          <AgentName id={by} />
        </b>{" "}
        {t("browser.handedYou")}
        {reason ? `: ${reason.replace(/\.$/, "")}. ` : ". "}
        {t("browser.handoffDone")}
      </span>
      <Button
        size="sm"
        className="btoolbar__btn"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await browserControl(tab.tab, "done");
          setBusy(false);
        }}
      >
        {t("common.done")}
      </Button>
    </div>
  );
}

/** Tabs record who drives them by agent id; people read the name. */
function AgentName({ id }: { id: string }) {
  return <>{useData((s) => s.agents[id]?.name) ?? id}</>;
}

function AgentUsing({ id }: { id: string }) {
  const t = useT();
  const name = useData((s) => s.agents[id]?.name);
  return <>{t("browser.agentUsing", { name: name ?? id })}</>;
}
