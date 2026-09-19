import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Check, Search, Sparkles, X } from "lucide-react";
import { Button, Dialog, Field, Textarea } from "../ui";
import { AgentAvatar, SUPER_AGENT_ICON } from "../agents/AgentAvatar";
import { ForwardedQuote } from "./ForwardedQuote";
import { useSessionRows } from "./SessionPicker";
import { Agents } from "../../lib/api";
import { canReceiveForward, forwardPeople, type ForwardPerson } from "../../lib/forwarded";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { Forwarded } from "../../lib/forwarded";
import type { ChatKey } from "./ChatList";
import type { AgentEntry } from "../../types/daemon";

// Hand one message to another conversation.
//
// Two decisions, in the order a person makes them: WHO should see this, and —
// only then, and only if the default is wrong — WHERE in their history it
// should land. The second one is pre-answered with the session they were last
// in, because that is what "continuar la charla" means nine times out of ten;
// "Sesión nueva" is always the first row for the tenth.
//
// "Who" includes the people in OTHER projects. An install is one set of agents
// as far as the person using it is concerned, and which project an agent
// happens to live in is not a reason to be unable to show them something.
// Sending across one is a navigation, so it goes through lib/forward-handoff.ts.
//
// What is NOT offered as a destination is as deliberate as what is — see
// `canReceiveForward`. The list simply does not draw a door into a wall.

interface Props {
  pid: string;
  /** What is being forwarded, already shaped: the quote and where it came
   *  from. Null → the dialog is closed. */
  fwd: Forwarded | null;
  agents: AgentEntry[];
  /** The virtual slug the panel addresses the super-agent by, and its face. */
  superAgentSlug: string;
  superAgentLabel: string;
  superAgentIcon?: string;
  /** Where the message came from, so the dialog does not offer to forward a
   *  message into the conversation it is already in. */
  origin?: ChatKey;
  onClose: () => void;
  /** `targetPid` is the project the chosen agent lives in — the current one
   *  unless the reader reached across. */
  onSend: (target: ChatKey, note: string, targetPid: string) => void;
}

/** A session the forward can land in. `null` key = start a fresh one. */
type Choice = { id: string; label: string; hint?: string; key: ChatKey | null };

/** Slugs are unique inside a project and not across them, so a row is addressed
 *  by both. */
const personId = (p: ForwardPerson, pid: string) => `${p.projectId || pid}:${p.slug}`;

/** Past this many people the list needs a way in. About what fits without
 *  scrolling; below it, scanning is faster than typing. */
const SEARCH_FROM = 6;

export function ForwardDialog({
  pid,
  fwd,
  agents,
  superAgentSlug,
  superAgentLabel,
  superAgentIcon,
  origin,
  onClose,
  onSend,
}: Props) {
  const [picked, setPicked] = useState<ForwardPerson | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");

  // Every open starts clean. A dialog that remembered the last agent would put
  // the wrong name under the confirm button of a message going somewhere else.
  useEffect(() => {
    if (!fwd) return;
    setPicked(null);
    setSessionId(null);
    setNote("");
    setQuery("");
  }, [fwd]);

  // Everybody, from every project — asked for only while the dialog is open,
  // and cached by SWR so opening it again is instant.
  const directory = useSWR(fwd ? "/api/agents/directory" : null, () => Agents.directory());

  const { groups, total } = useMemo(
    () =>
      forwardPeople({
        pid,
        superAgent: { slug: superAgentSlug, name: superAgentLabel, icon: superAgentIcon || SUPER_AGENT_ICON },
        here: agents,
        directory: directory.data || [],
        query,
      }),
    [pid, superAgentSlug, superAgentLabel, superAgentIcon, agents, directory.data, query],
  );

  const targetPid = picked?.projectId || pid;
  const isSuper = !!picked && picked.slug === superAgentSlug;
  const sessions = useSessionRows(targetPid, picked?.slug || "", isSuper, !!picked && !!fwd);

  // The sessions this message may actually be dropped into, newest first, with
  // a fresh one always on top.
  const choices: Choice[] = useMemo(() => {
    const fresh: Choice = { id: "__new__", label: t("forward.new_session"), key: null };
    const rows = (sessions.data || [])
      // The "not into itself" rule only means something inside one project: two
      // projects can each hold a conversation with the same id, and comparing
      // them across would hide a perfectly good destination.
      .filter((s) => canReceiveForward(s, targetPid === pid ? origin : undefined))
      .slice(0, 12)
      .map((s) => ({
        id: s.id,
        label: s.label,
        hint: [s.channel, relativeWhen(s.when, t as never)].filter(Boolean).join(" · "),
        key: s.key,
      }));
    return [fresh, ...rows];
  }, [sessions.data, origin, targetPid, pid]);

  // The most recent usable session, preselected — that is what continuing a
  // conversation means. Only once per agent: after that the reader's pick wins.
  useEffect(() => {
    if (!picked || sessionId) return;
    if (sessions.isLoading) return;
    setSessionId(choices[1]?.id || "__new__");
  }, [picked, sessionId, sessions.isLoading, choices]);

  const chosen = choices.find((c) => c.id === sessionId) || choices[0];
  const target = chosen?.key ?? (picked ? ({ kind: "live", agentSlug: picked.slug } as ChatKey) : null);

  const submit = () => {
    if (!target) return;
    onSend(target, note.trim(), targetPid);
  };

  // Decided by how many people EXIST, never by how many the query matched. The
  // other way round, one mistyped letter emptied the list and took the search
  // field away with it — leaving no way to correct the typo, and a dialog that
  // said "no agents" to somebody who had twenty.
  const searchable = total > SEARCH_FROM;
  const empty = !groups.length;

  return (
    <Dialog
      open={!!fwd}
      onClose={onClose}
      title={t("forward.dialog_title")}
      description={t("forward.dialog_hint")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!target}
            data-testid="forward-confirm"
          >
            {picked ? t("forward.send_to", { name: picked.name }) : t("forward.action")}
          </Button>
        </>
      }
    >
      {fwd && (
        <div className="flex flex-col gap-4">
          {/* What is going. First, and shown exactly as it will read on the
              other side — a forward you cannot see before sending is a forward
              you check afterwards, in somebody else's conversation. */}
          <ForwardedQuote fwd={fwd} />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">{t("forward.to_label")}</span>
            {searchable && (
              // A row of its own, the full width of the dialog. It used to be a
              // 160px box wedged in beside the label, which is where a control
              // goes when it is an afterthought rather than the way in.
              <div className="relative">
                <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-fg" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("forward.search_ph")}
                  data-testid="forward-search"
                  className="h-8 w-full rounded-lg border border-input bg-transparent pl-8 pr-8 text-[13px] outline-none placeholder:text-muted-fg focus:border-ring"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    data-testid="forward-search-clear"
                    aria-label={t("forward.show_all")}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-fg hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pr-1">
              {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-0.5">
                  {/* Only the OTHER projects get a heading. The one you are
                      standing in needs no label saying so. */}
                  {group.label && (
                    <span className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
                      {group.label}
                    </span>
                  )}
                  {group.people.map((p) => {
                    const id = personId(p, pid);
                    const active = !!picked && personId(picked, pid) === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`forward-agent-${p.slug}`}
                        onClick={() => { setPicked(p); setSessionId(null); }}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                          active ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/60",
                        )}
                      >
                        <AgentAvatar icon={p.icon} emoji={p.emoji} name={p.name} size={24} />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                        {p.isSuper && (
                          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-fg">
                            {t("forward.super_agent_tag")}
                          </span>
                        )}
                        {active && <Check size={13} className="shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {empty && (
                // Says what happened, and offers the way out of it. "No agents"
                // was both wrong and a dead end.
                <div className="flex flex-col items-start gap-1 px-2 py-3" data-testid="forward-no-matches">
                  <p className="text-xs text-muted-fg">
                    {query ? t("forward.no_matches", { query }) : t("forward.no_agents")}
                  </p>
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t("forward.show_all")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Where it lands. Only once somebody is chosen — a list of sessions
              with no owner is a list of dates. */}
          {picked && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">{t("forward.session_label")}</span>
              {sessions.isLoading ? (
                <p className="text-xs text-muted-fg">{t("common.loading")}</p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
                  {choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`forward-session-${c.id}`}
                      onClick={() => setSessionId(c.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                        c.id === sessionId
                          ? "border-primary/50 bg-primary/10"
                          : "border-transparent hover:bg-muted/60",
                      )}
                    >
                      {c.key === null && <Sparkles size={13} className="shrink-0 text-primary" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{c.label}</span>
                        {c.hint && <span className="block truncate text-[10px] text-muted-fg">{c.hint}</span>}
                      </span>
                      {c.id === sessionId && <Check size={13} className="shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Field label={t("forward.note_label")} hint={t("forward.note_hint")}>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("forward.note_ph")}
              data-testid="forward-note"
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
