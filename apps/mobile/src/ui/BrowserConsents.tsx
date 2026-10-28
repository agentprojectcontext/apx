import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ToolApproval } from "../../../../packages/protocol/src/domain.ts";
import type { Agent, Thread } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";
import { BottomSheet, Button } from "./kit";
import { makeStyles } from "./theme";

export function BrowserConsents({
  client,
  thread,
  agents,
  threads,
}: {
  client: ApxClient;
  thread: string;
  agents: Agent[];
  threads: Thread[];
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<ToolApproval[]>([]);
  const latest = useRef(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<"load" | "revoke">();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const { approvals } = await client.call("tools.approvals", {});
      if (request !== latest.current) return;
      setGrants(
        approvals.filter((g) => g.browser && g.thread_id === thread && (g.scope === "tab" || g.scope === "turn")),
      );
      setFailure(undefined);
    } catch {
      if (request === latest.current) setFailure("load");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [client, thread]);
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
      ? `${g.browser?.title || t("browserUntitled")} · ${g.browser?.tab_number ? t("browserTabNumber", { n: g.browser.tab_number }) : t("browserPermissionNumber", { n: grants.indexOf(g) + 1 })}`
      : t("browserTurn");
  const context = (g: ToolApproval) =>
    `${g.browser?.origin} · ${tabLabel(g)} · ${agents.find((a) => a.id === g.agent_id)?.name ?? t("browserAgent")} · ${threads.find((th) => th.id === g.thread_id)?.title || t("browserChat")}`;
  const revoke = async (g: ToolApproval) => {
    const request = latest.current;
    setBusy(g.key);
    try {
      await client.call("tools.revoke", { key: g.key, thread: g.thread_id, agent: g.agent_id });
      if (request === latest.current) {
        setNotice(t("browserRevoked", { context: context(g) }));
        await refresh();
      }
    } catch {
      if (request === latest.current) setFailure("revoke");
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <Button size="sm" variant="secondary" label={t("browserPermissions")} onPress={() => setOpen(true)} />
      {open ? (
        <BottomSheet title={t("browserPermissions")} onClose={() => setOpen(false)}>
          <View style={s.list}>
            <Text style={s.help}>{t("browserPermissionsHelp")}</Text>
            <Button
              size="sm"
              variant="secondary"
              label={t("browserRefresh")}
              busy={loading}
              disabled={loading || Boolean(busy)}
              onPress={() => void refresh()}
            />
            <Text accessibilityLiveRegion="polite" style={s.help}>
              {notice}
            </Text>
            {failure ? (
              <Text accessibilityRole="alert" style={s.help}>
                {t(failure === "load" ? "browserLoadFailed" : "browserRevokeFailed")}
              </Text>
            ) : !loading && !grants.length ? (
              <Text style={s.help}>{t("browserNone")}</Text>
            ) : null}
            {grants.map((g) => (
              <View key={g.key} style={s.grant}>
                <Text selectable style={s.title}>
                  {g.browser?.origin} · {t(g.scope === "tab" ? "browserTab" : "browserTurn")}
                </Text>
                {g.scope === "tab" ? <Text style={s.help}>{tabLabel(g)}</Text> : null}
                <Text style={s.help}>
                  {agents.find((a) => a.id === g.agent_id)?.name ?? t("browserAgent")} ·{" "}
                  {threads.find((th) => th.id === g.thread_id)?.title || t("browserChat")}
                </Text>
                {g.scope === "turn" ? (
                  <Text style={s.help}>{t("browserTurnEnds")}</Text>
                ) : g.expires_at ? (
                  <Text style={s.help}>{t("browserExpires", { at: new Date(g.expires_at).toLocaleString() })}</Text>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  label={t("browserRevoke")}
                  accessibilityLabel={t("browserRevokeLabel", { context: context(g) })}
                  busy={busy === g.key}
                  disabled={Boolean(busy) || loading || Boolean(failure)}
                  onPress={() => void revoke(g)}
                />
              </View>
            ))}
          </View>
        </BottomSheet>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  list: { padding: 16, gap: 12 },
  grant: { paddingVertical: 12, gap: 8, borderTopWidth: 1, borderTopColor: theme.border },
  title: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  help: { color: theme.fgMuted, fontSize: 13 },
}));
