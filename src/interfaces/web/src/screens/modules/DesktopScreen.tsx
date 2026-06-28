import { useMemo } from "react";
import useSWR from "swr";
import { Section } from "../../components/Section";
import { Loading, Empty } from "../../components/ui";
import { DesktopStatusCard } from "../../components/desktop/DesktopStatusCard";
import { fetchDesktopMessages, type GlobalMessage } from "../../lib/api/desktop";
import { t } from "../../i18n";

// Desktop module — the floating voice window (the Electron app launched with
// `apx desktop start`). This rail surface shows live status + lifecycle
// controls and the last conversation; all persisted settings (autostart,
// shortcut, appearance, activation) live in Settings → Desktop.
export function DesktopScreen() {
  const { data: msgs, isLoading: msgsLoading, mutate: mutateMsgs } = useSWR(
    "/messages/global?channel=desktop",
    () => fetchDesktopMessages(40),
    { refreshInterval: 8000 },
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="screen-desktop">
      {/* ── Two-column layout: status on the left, last conversation on the right. ── */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ── LEFT: live status + lifecycle + link to configuration ─────── */}
        <div>
          <DesktopStatusCard showConfigLink />
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
