import type { ToolApproval } from "@apx/protocol";
import { Button, Dialog } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { listApprovals, revokeApproval } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/** Temporary browser permissions remain reachable while an agent is running. */
export function BrowserConsents() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<ToolApproval[]>([]);
  const latest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<"load" | "revoke">();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    const all = await listApprovals({ quiet: true });
    if (request !== latest.current) return;
    setFailure(all ? undefined : "load");
    if (all) setGrants(all.filter((g) => g.browser && (g.scope === "tab" || g.scope === "turn")));
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    setNotice("");
    void refresh();
    return () => {
      latest.current++;
    };
  }, [open, refresh]);
  const tabLabel = (g: ToolApproval) =>
    g.scope === "tab"
      ? `${g.browser?.title || t("res.browserUntitled")} · ${g.browser?.tab_number ? t("res.browserTabNumber", { n: g.browser.tab_number }) : t("res.browserPermissionNumber", { n: grants.indexOf(g) + 1 })}`
      : t("res.browserTurn");
  const context = (g: ToolApproval) =>
    `${g.browser?.origin} · ${tabLabel(g)} · ${(g.agent_id ? agents[g.agent_id]?.name : undefined) ?? t("res.browserAgent")} · ${(g.thread_id ? threads[g.thread_id]?.title : undefined) || t("res.browserChat")}`;
  const revoke = async (g: ToolApproval) => {
    const request = latest.current;
    setBusy(g.key);
    const result = await revokeApproval(g.key, g.thread_id, g.agent_id, { quiet: true });
    setBusy(undefined);
    if (request !== latest.current) return;
    if (result) {
      setNotice(t("res.browserRevoked", { context: context(g) }));
      await refresh();
    } else setFailure("revoke");
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("res.browserPermissions")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("res.browserPermissions")} closeLabel={t("common.close")}>
        <section className="resd" aria-label={t("res.browserPermissions")}>
          <p className="resd__note">{t("res.browserPermissionsHelp")}</p>
          <Button
            size="sm"
            variant="secondary"
            loading={loading}
            disabled={loading || Boolean(busy)}
            onClick={() => void refresh()}
          >
            {t("res.browserRefresh")}
          </Button>
          <p role="status" aria-live="polite">
            {notice}
          </p>
          <div aria-live="polite" aria-busy={loading}>
            {failure ? (
              <p role="alert">{t(failure === "load" ? "res.browserLoadFailed" : "res.browserRevokeFailed")}</p>
            ) : !loading && !grants.length ? (
              <p>{t("res.browserNone")}</p>
            ) : null}
            {grants.map((g) => (
              <div key={g.key} className="resd__grant">
                <p>
                  <strong>{g.browser?.origin}</strong> · {t(g.scope === "tab" ? "res.browserTab" : "res.browserTurn")}
                </p>
                {g.scope === "tab" && <p>{tabLabel(g)}</p>}
                <p>
                  {(g.agent_id ? agents[g.agent_id]?.name : undefined) ?? t("res.browserAgent")} ·{" "}
                  {(g.thread_id ? threads[g.thread_id]?.title : undefined) || t("res.browserChat")}
                </p>
                {g.scope === "turn" ? (
                  <p>{t("res.browserTurnEnds")}</p>
                ) : g.expires_at ? (
                  <p>{t("res.browserExpires", { at: new Date(g.expires_at).toLocaleString() })}</p>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busy) || loading || Boolean(failure)}
                  aria-label={t("res.browserRevokeLabel", { context: context(g) })}
                  loading={busy === g.key}
                  onClick={() => void revoke(g)}
                >
                  {t("res.browserRevoke")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      </Dialog>
    </>
  );
}
