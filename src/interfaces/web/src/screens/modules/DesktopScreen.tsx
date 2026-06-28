import { useMemo } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { Settings } from "lucide-react";
import { Section, Kbd, StatusDot } from "../../components/Section";
import { Button, Loading, Empty } from "../../components/ui";
import { Desktop, fetchDesktopMessages, type GlobalMessage } from "../../lib/api/desktop";
import { t } from "../../i18n";

// Desktop module — the floating voice window (the Electron app launched with
// `apx desktop start`). The window is a separate process spawned by the CLI, so
// the web admin doesn't start/stop it from here. This rail surface shows only
// live status and the last conversation; all persisted settings (autostart,
// shortcut, appearance, activation) live in Settings → Desktop.
export function DesktopScreen() {
  const { data: status, isLoading: stLoading, mutate: mutateStatus } = useSWR(
    "/desktop/status",
    () => Desktop.status(),
    { refreshInterval: 5000 },
  );
  const running = !!status?.running;

  const { data: msgs, isLoading: msgsLoading, mutate: mutateMsgs } = useSWR(
    "/messages/global?channel=desktop",
    () => fetchDesktopMessages(40),
    { refreshInterval: 8000 },
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="screen-desktop">
      {/* ── Two-column layout: status on the left, last conversation on the right. ── */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ── LEFT: live status + link to configuration ─────────────────── */}
        <div>
          <Section
            title={t("desktop_screen.status_title")}
            description={t("modules_ui.desktop_status_desc")}
            action={
              <Link to="/settings/desktop">
                <Button size="sm" variant="ghost">
                  <Settings size={14} /> {t("desktop_screen.open_config")}
                </Button>
              </Link>
            }
          >
            {stLoading ? <Loading /> : (
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={running} />
                <span className="font-medium">{running ? t("modules_ui.desktop_running") : t("modules_ui.desktop_stopped")}</span>
                <button
                  type="button"
                  onClick={() => mutateStatus()}
                  className="ml-2 text-xs text-muted-fg underline-offset-2 hover:underline"
                >
                  {t("modules_ui.desktop_refresh")}
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-fg">
              {t("modules_ui.desktop_from_terminal")} <Kbd>apx desktop start</Kbd> · <Kbd>apx desktop --debug</Kbd>
            </p>
          </Section>
        </div>

        {/* ── RIGHT: last conversation preview ─────────────────────────── */}
        <div>
          <Section
            title={t("desktop_screen.last_conv_title")}
            description={t("modules_ui.desktop_last_conv_desc")}
            action={
              <button
                type="button"
                onClick={() => mutateMsgs()}
                className="text-xs text-muted-fg underline-offset-2 hover:underline"
              >
                {t("modules_ui.desktop_refresh")}
              </button>
            }
          >
            <DesktopLastConversation
              messages={msgs || []}
              loading={msgsLoading}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Last-conversation panel ─────────────────────────────────────────────

function DesktopLastConversation({ messages, loading }: { messages: GlobalMessage[]; loading: boolean }) {
  // Group by exchange: a user turn + everything that follows until the next
  // user turn. Show the LAST exchange front-and-center, older ones beneath.
  const groups = useMemo(() => groupExchanges(messages), [messages]);

  if (loading) return <Loading />;
  if (!messages.length) return <Empty>{t("modules_ui.desktop_no_messages")}</Empty>;

  return (
    <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
      {groups.slice().reverse().map((g, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-card/40 p-3">
          {g.map((m, i) => <MessageLine key={i} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function MessageLine({ m }: { m: GlobalMessage }) {
  const isUser = m.direction === "in";
  const when = formatWhen(m.ts);
  return (
    <div className="py-1">
      <div className="flex items-baseline gap-2 text-[11px] text-muted-fg">
        <span className="font-semibold">{isUser ? t("modules_ui.desktop_you") : t("modules_ui.desktop_roby")}</span>
        <span>{when}</span>
      </div>
      <div className={"mt-0.5 text-sm leading-snug whitespace-pre-wrap " + (isUser ? "text-muted-fg" : "text-fg")}>
        {(m.body || "").trim() || <span className="italic opacity-50">{t("modules_ui.desktop_empty_msg")}</span>}
      </div>
    </div>
  );
}

function groupExchanges(messages: GlobalMessage[]): GlobalMessage[][] {
  // messages come oldest-first; chunk on user-direction boundaries.
  const out: GlobalMessage[][] = [];
  for (const m of messages) {
    if (m.direction === "in" || !out.length) out.push([m]);
    else out[out.length - 1].push(m);
  }
  return out;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    return same
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
