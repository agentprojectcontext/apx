import type { ToolApproval } from "@apx/protocol";
import { Button, SettingRow } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalText } from "../common/ApprovalText.tsx";
import { listApprovals, revokeApproval } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

/** How often the list is read again while it is on screen: a tab's permission lasts at most 30 minutes. */
const REFRESH_MS = 5000;

/**
 * The pages where the owner let an agent run JavaScript for a while (a tab, or one answer), each with Revoke
 * (DECISIONS.md#d-165). Read again on its own while shown, so what is listed is what still holds.
 */
export function BrowserPermissions() {
  return (
    <ApprovalText context="browser">
      <BrowserPermissionsBody />
    </ApprovalText>
  );
}

function BrowserPermissionsBody() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const [grants, setGrants] = useState<ToolApproval[]>();
  const [failure, setFailure] = useState<"load" | "revoke">();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    if (document.hidden) return;
    const request = ++latest.current;
    const all = await listApprovals({ quiet: true });
    if (request !== latest.current) return;
    if (all) setGrants(all.filter((g) => g.browser && (g.scope === "tab" || g.scope === "turn")));
    setFailure((now) => (all ? (now === "revoke" ? now : undefined) : "load"));
  }, []);
  useEffect(() => {
    const wake = () => void refresh();
    wake();
    const timer = setInterval(wake, REFRESH_MS);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      latest.current++;
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);
  const who = (g: ToolApproval) =>
    `${(g.agent_id ? agents[g.agent_id]?.name : undefined) ?? t("res.browserAgent")} · ${(g.thread_id ? threads[g.thread_id]?.title : undefined) || t("res.browserChat")}`;
  const where = (g: ToolApproval, i: number) =>
    g.scope === "tab"
      ? `${g.browser?.title || t("res.browserUntitled")} · ${g.browser?.tab_number ? t("res.browserTabNumber", { n: g.browser.tab_number }) : t("res.browserPermissionNumber", { n: i + 1 })}`
      : t("res.browserTurn");
  const revoke = async (g: ToolApproval, i: number) => {
    setBusy(g.key);
    setNotice("");
    setFailure(undefined);
    const done = await revokeApproval(g.key, g.thread_id, g.agent_id, { quiet: true });
    setBusy(undefined);
    if (done) {
      setNotice(t("res.browserRevoked", { context: `${g.browser?.origin} · ${where(g, i)}` }));
      setGrants((now) => now?.filter((x) => x.key !== g.key));
      await refresh();
    } else setFailure("revoke");
  };
  return (
    <section className="config__section" aria-label={t("res.browserPermissions")}>
      <SubHead>{t("res.browserPermissions")}</SubHead>
      <p className="config__hint">{t("res.browserPermissionsHelp")}</p>
      <p role="status" aria-live="polite" className="config__hint">
        {notice}
      </p>
      {failure && (
        <p role="alert" className="config__hint is-error">
          {t(failure === "load" ? "res.browserLoadFailed" : "res.browserRevokeFailed")}
        </p>
      )}
      <div aria-busy={grants === undefined}>
        {grants && !grants.length && <p className="config__hint">{t("res.browserNone")}</p>}
        {grants?.map((g, i) => (
          <SettingRow
            key={g.key}
            title={g.browser?.origin}
            description={[
              g.scope === "tab" ? where(g, i) : t("res.browserTurn"),
              who(g),
              g.scope === "turn"
                ? t("res.browserTurnEnds")
                : g.expires_at
                  ? t("res.browserExpires", {
                      at: new Date(g.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    })
                  : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              loading={busy === g.key}
              aria-label={t("res.browserRevokeLabel", { context: `${g.browser?.origin} · ${where(g, i)} · ${who(g)}` })}
              onClick={() => void revoke(g, i)}
            >
              {t("res.browserRevoke")}
            </Button>
          </SettingRow>
        ))}
      </div>
    </section>
  );
}
