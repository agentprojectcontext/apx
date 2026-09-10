// Settings → WhatsApp. One session, its roster, and the stickers it has learned.
//
// The shape mirrors Telegram's tabbed panel, with one deliberate difference:
// there is no channel list. A Telegram bot token is cheap and you can hold
// twenty; a WhatsApp session IS an account, and an account is a phone number.
// So this page edits one session and the people it is allowed to answer.

import { useCallback, useEffect, useState } from "react";
import { Section } from "../Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../ui";
import { Ban, Check, Star, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tip } from "../ui/tip";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { WhatsApp } from "../../lib/api/whatsapp";
import type { WhatsAppContact, WhatsAppStatus, WhatsAppSticker, WhatsAppSuggestion } from "../../lib/api/whatsapp";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

type Tab = "session" | "contacts" | "stickers";
const TABS: Tab[] = ["session", "contacts", "stickers"];
// `?tab=pending` was a tab of its own until the requests moved on top of the
// roster, where the owner would actually see them. Links to it exist — in the
// docs, in messages an agent has sent — so it lands on the page that now holds
// them instead of silently falling back to Session.
const ALIASES: Record<string, Tab> = { pending: "contacts" };

/**
 * The open tab lives in the URL (`/settings/whatsapp?tab=contacts`).
 *
 * localStorage remembered it too, and that is the wrong store for this: it made
 * the tab a property of the BROWSER rather than of the address, so the panel
 * could not be linked to, could not be reloaded onto the tab you were reading,
 * and Back walked out of the whole page instead of to the previous tab.
 */
/**
 * How many things are waiting on the owner: contacts APX vouched for and nobody
 * has vetted, plus requests a contact made that nobody has dealt with.
 *
 * Both live behind the Contacts tab now, so the badge is what says there is a
 * reason to open it.
 */
function useWaitingCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [c, s] = await Promise.all([WhatsApp.contacts.list(), WhatsApp.suggestions.list()]);
        if (!alive) return;
        const review = (c.contacts || []).filter((x) => x.pending_review).length;
        setN(review + (s.suggestions || []).length);
      } catch { /* daemon down: no badge rather than a wrong one */ }
    })();
    return () => { alive = false; };
  }, []);
  return n;
}

export function WhatsAppSettingsTabs() {
  const waiting = useWaitingCount();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : (raw && ALIASES[raw]) || "session";
  const onChange = (v: string) => {
    const next = (TABS.includes(v as Tab) ? v : "session") as Tab;
    // `replace` so flipping between tabs does not stack history entries — Back
    // should leave the page, not walk you through every tab you glanced at.
    setParams(next === "session" ? {} : { tab: next }, { replace: true });
  };

  return (
    <Tabs value={tab} onValueChange={onChange} className="w-full">
      <TabsList>
        <TabsTrigger value="session">{t("settings.whatsapp.session")}</TabsTrigger>
        <TabsTrigger value="contacts">
          {t("settings.whatsapp.contacts")}
          {/* How many people are waiting on a decision, on the tab itself: the
              count is the reason to open it, and it was previously only
              visible AFTER opening the tab that had it. */}
          {waiting > 0 && (
            <span className="ml-1.5 rounded-full bg-brand/15 px-1.5 text-[11px] font-medium text-brand">
              {waiting}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="stickers">{t("settings.whatsapp.stickers")}</TabsTrigger>
      </TabsList>
      <TabsContent value="session" className="mt-4"><SessionPanel /></TabsContent>
      <TabsContent value="contacts" className="mt-4"><ContactsPanel /></TabsContent>
      <TabsContent value="stickers" className="mt-4"><StickersPanel /></TabsContent>
    </Tabs>
  );
}

// ── Session ─────────────────────────────────────────────────────────────────

const STATE_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  connected: "success",
  pairing: "warning",
  connecting: "warning",
  logged_out: "danger",
  off: "muted",
};

function SessionPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<{ dataUrl: string | null; raw: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await WhatsApp.status());
    } catch {
      setStatus(null);            // plugin not loaded, or the daemon is down
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // While a QR is on screen it is a race against its own ~20s life, and the
  // moment the phone scans it the state flips to connected. Poll only then —
  // a background poll on a settled page is just noise on the daemon.
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(id);
  }, [qr, refresh]);

  useEffect(() => {
    if (status?.state === "connected" && qr) {
      setQr(null);
      toast.success(t("settings.whatsapp.state.connected"));
    }
  }, [status?.state, qr, toast]);

  const pair = async () => {
    setBusy(true);
    try {
      const r = await WhatsApp.pair();
      if (r.qr_data_url || r.qr) setQr({ dataUrl: r.qr_data_url, raw: r.qr });
      else toast.error(r.note || "no QR");
      setStatus(r.status);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    try {
      setStatus(await WhatsApp.logout());
      setQr(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); setConfirmLogout(false); }
  };

  const patch = async (body: Partial<WhatsAppStatus> & { owner_jid?: string }) => {
    try {
      await WhatsApp.settings(body);
      await refresh();
      toast.success(t("settings.whatsapp.saved"));
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading) return <Loading />;
  if (!status) {
    return (
      <Section title={t("settings.whatsapp.title")} description={t("settings.whatsapp.subtitle")}>
        <Empty>The WhatsApp plugin is not loaded in this daemon.</Empty>
      </Section>
    );
  }

  const stateLabel = t(`settings.whatsapp.state.${status.state}` as Parameters<typeof t>[0]);

  return (
    <Section title={t("settings.whatsapp.title")} description={t("settings.whatsapp.subtitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[status.state] || "muted"}>{stateLabel}</Badge>
          {status.me && <span className="text-xs text-muted-foreground">{shortJid(status.me)}</span>}
          {status.last_error && status.state !== "connected" && (
            <span className="text-xs text-muted-foreground">· {status.last_error}</span>
          )}
        </div>

        {status.state !== "connected" && (
          <div className="space-y-3">
            <Button onClick={pair} disabled={busy}>{t("settings.whatsapp.pair")}</Button>
            {qr && (
              <div className="space-y-2">
                {qr.dataUrl
                  ? <img src={qr.dataUrl} alt="WhatsApp QR" className="rounded-lg border border-border bg-white p-2" width={280} height={280} />
                  : <pre className="overflow-x-auto rounded-lg border border-border p-2 text-[10px]">{qr.raw}</pre>}
                <p className="max-w-md text-[11px] text-muted-foreground">{t("settings.whatsapp.pairing_hint")}</p>
              </div>
            )}
          </div>
        )}

        {status.state === "connected" && (
          <Button variant="ghost" onClick={() => setConfirmLogout(true)} disabled={busy}>
            {t("settings.whatsapp.logout")}
          </Button>
        )}

        <Field label={t("settings.whatsapp.self_is_owner")} hint={t("settings.whatsapp.self_is_owner_hint")}>
          <Switch
            checked={status.self_is_owner === true}
            onChange={(v) => patch({ self_is_owner: v })}
          />
        </Field>

        <Field
          label={t("settings.whatsapp.owner")}
          hint={status.owner_jid ? t("settings.whatsapp.owner_hint") : undefined}
        >
          {status.owner_jid ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{shortJid(status.owner_jid)}</Badge>
              {status.owner_alts && status.owner_alts.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {t("settings.whatsapp.owner_alts", { count: status.owner_alts.length })}
                </span>
              )}
              <Button variant="ghost" onClick={async () => {
                try { await WhatsApp.clearOwner(); await refresh(); } catch (e) { toast.error((e as Error).message); }
              }}>{t("settings.whatsapp.owner_clear")}</Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("settings.whatsapp.owner_none")}</p>
          )}
        </Field>

        <Field label={t("settings.whatsapp.auto_reply")} hint={t("settings.whatsapp.auto_reply_hint")}>
          <Switch checked={status.auto_reply} onChange={(v) => patch({ auto_reply: v })} />
        </Field>

        <Field label={t("settings.whatsapp.reply_to_groups")} hint={t("settings.whatsapp.reply_to_groups_hint")}>
          <Switch checked={status.reply_to_groups} onChange={(v) => patch({ reply_to_groups: v })} />
        </Field>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title={t("settings.whatsapp.logout")}
        description={t("settings.whatsapp.logout_confirm")}
        confirmLabel={t("settings.whatsapp.logout")}
        destructive
        onConfirm={logout}
      />
    </Section>
  );
}

// ── Contacts ────────────────────────────────────────────────────────────────
//
// A LIST, not a page of forms. Every contact used to render its five fields
// expanded, so three people made a wall of textareas and the two buttons that
// matter were lost in it — one of which archived the row on a single click.
//
// So: one compact row each, the two decisions that get made constantly (answer
// them / don't) as ✓ and ✗, and everything rarer behind Edit. Promoting to
// owner and removing both live in the dialog now, because they are the two
// actions you cannot take back and they were sitting where the frequent ones go.

function ContactsPanel() {
  const toast = useToast();
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [owner, setOwner] = useState<{ jid: string | null; alts: string[] }>({ jid: null, alts: [] });
  const [roles, setRoles] = useState<string[]>([]);
  const [relationships, setRelationships] = useState<string[]>([]);
  const [capList, setCapList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WhatsAppContact | null>(null);
  const [promoting, setPromoting] = useState<WhatsAppContact | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, st] = await Promise.all([WhatsApp.contacts.list(), WhatsApp.status()]);
      setContacts(r.contacts || []);
      setRoles(["guest", "contact", ...Object.keys(r.roles || {})].filter((v, i2, a) => a.indexOf(v) === i2));
      setRelationships(r.relationships || []);
      setCapList(r.capabilities || []);
      setOwner({ jid: st.owner_jid, alts: st.owner_alts || [] });
    } catch { /* daemon down */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const patch = async (jid: string, body: Partial<WhatsAppContact>) => {
    try { await WhatsApp.contacts.patch(jid, body); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  // Is this row the owner? Matched across every address they answer to, not
  // just the primary — the same set-matching the backend does.
  const ownerAddrs = [owner.jid, ...owner.alts].filter(Boolean).map(String);
  const isOwnerRow = (c: WhatsAppContact) =>
    [c.jid, ...(c.alts || [])].some((a) => ownerAddrs.some((o) => shortJid(o) === shortJid(a || "")));

  if (loading) return <Loading />;

  // Two groups, one list. A row APX added because it was told to write to
  // somebody is answerable and NOT vetted — nobody has said who they are — and
  // it looks exactly like a contact the owner curated by hand. Sitting in
  // alphabetical order among forty others, that difference is invisible, so the
  // ones waiting on a decision come first, under their own heading, and
  // everybody else follows.
  const waiting = contacts.filter((c) => c.pending_review && !isOwnerRow(c));
  const settled = contacts.filter((c) => !waiting.includes(c));

  const rows = (list: WhatsAppContact[]) => (
        <div className="divide-y divide-border rounded-lg border border-border">
          {list.map((c) => {
            const answered = c.role !== "guest" && c.auto_reply !== false;
            return (
              <div key={c.jid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <ContactFace contact={c} />
                {/* The star IS the control. "This is me" as a button buried in
                    the dialog read like a label and said nothing about who the
                    owner currently was; a star that is lit on exactly one row
                    answers both questions at once, and moving it is the
                    gesture. */}
                <Tip content={isOwnerRow(c) ? t("settings.whatsapp.is_owner_note") : t("settings.whatsapp.make_owner")}>
                  <Button
                    variant="ghost"
                    className="size-7 shrink-0 p-0"
                    aria-label={isOwnerRow(c) ? t("settings.whatsapp.role_owner") : t("settings.whatsapp.make_owner")}
                    aria-pressed={isOwnerRow(c)}
                    onClick={() => { if (!isOwnerRow(c)) setPromoting(c); }}
                  >
                    <Star
                      size={15}
                      className={isOwnerRow(c) ? "text-brand" : "text-muted-foreground/40"}
                      fill={isOwnerRow(c) ? "currentColor" : "none"}
                    />
                  </Button>
                </Tip>
                <span className="text-sm font-medium">{c.nickname || c.name || shortJid(c.jid)}</span>
                <span className="text-xs text-muted-foreground">{shortJid(c.jid)}</span>
                {c.relationship && (
                  <span className="text-xs text-muted-foreground">· {relLabel(c.relationship)}</span>
                )}
                <Badge tone={isOwnerRow(c) ? "success" : answered ? "info" : "muted"}>
                  {isOwnerRow(c) ? t("settings.whatsapp.role_owner") : roleLabel(c.role)}
                </Badge>
                {/* Answerable, but nobody has said who they are: APX added this
                    row because it was told to write to them. The distinction is
                    invisible otherwise — the row looks exactly like a contact
                    the owner curated by hand — and it disappears the moment
                    anyone edits the row, which is what reviewing it means. */}
                {c.pending_review && !isOwnerRow(c) && (
                  <Tip content={t("settings.whatsapp.pending_review_hint")}>
                    <Badge tone="warning">{t("settings.whatsapp.pending_review")}</Badge>
                  </Tip>
                )}

                <div className="ml-auto flex items-center gap-1">
                  {/* The everyday decision, and the only one on the row: do we
                      answer this person at all. ✓ promotes a guest and unmutes;
                      ✗ mutes without deleting anything.
                      Hidden for the owner: their role is overridden anyway, so
                      the pair rendered a lit ✗ next to the person who is always
                      answered — a control that both lies and does nothing. */}
                  {!isOwnerRow(c) && (<>
                  <Tip content={t("settings.whatsapp.accept")}>
                    <Button
                      variant={answered ? "primary" : "ghost"}
                      onClick={() => patch(c.jid, { role: "contact", auto_reply: true })}
                      aria-label={t("settings.whatsapp.accept")}
                    ><Check size={14} /></Button>
                  </Tip>
                  <Tip content={t("settings.whatsapp.reject")}>
                    <Button
                      variant={!answered ? "primary" : "ghost"}
                      onClick={() => patch(c.jid, { role: "guest", auto_reply: false })}
                      aria-label={t("settings.whatsapp.reject")}
                    ><X size={14} /></Button>
                  </Tip>
                  </>)}
                  <Button variant="ghost" onClick={() => setEditing(c)}>
                    {t("settings.whatsapp.edit")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
  );

  return (
    <Section title={t("settings.whatsapp.contacts")} description={t("settings.whatsapp.contacts_hint")}>
      {/* What somebody asked for and nobody has dealt with yet. It used to be a
          tab of its own, one click away and therefore unread: a request only
          matters while it is fresh, and the roster is the page the owner
          actually opens. */}
      <PendingRequests />

      {waiting.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.whatsapp.to_review")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("settings.whatsapp.to_review_hint")}</p>
          {rows(waiting)}
        </div>
      )}

      {contacts.length === 0 ? (
        <Empty>{t("settings.whatsapp.no_contacts")}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {waiting.length > 0 && (
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("settings.whatsapp.everyone")}
            </h3>
          )}
          {rows(settled)}
        </div>
      )}

      {/* Moving the star moves ownership — the one action here with no undo
          worth speaking of, so it asks. */}
      <ConfirmDialog
        open={!!promoting}
        onClose={() => setPromoting(null)}
        destructive={false}
        title={t("settings.whatsapp.make_owner")}
        description={t("settings.whatsapp.make_owner_confirm")}
        confirmLabel={t("settings.whatsapp.make_owner")}
        onConfirm={async () => {
          if (!promoting) return;
          try {
            await WhatsApp.contacts.makeOwner(promoting.jid);
            await refresh();
            toast.success(t("settings.whatsapp.made_owner"));
          } catch (e) { toast.error((e as Error).message); }
          finally { setPromoting(null); }
        }}
      />

      {editing && (
        <ContactDialog
          contact={editing}
          roles={roles}
          relationships={relationships}
          capabilities={capList}
          isOwner={isOwnerRow(editing)}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </Section>
  );
}

/**
 * The person's face, or their initial.
 *
 * Not decoration: a roster is a list of PEOPLE, and a column of identical rows
 * with a phone number on each is read one line at a time. WhatsApp hides the
 * picture from anyone outside the sender's contacts, so the fallback is the
 * common case rather than the error case — it has to look deliberate.
 */
function ContactFace({ contact }: { contact: WhatsAppContact }) {
  const [broken, setBroken] = useState(false);
  const label = (contact.nickname || contact.name || "?").trim();
  if (contact.avatar_url && !broken) {
    return (
      <img
        src={contact.avatar_url}
        alt=""
        className="size-7 shrink-0 rounded-full object-cover"
        // The URL is WhatsApp's own CDN and it expires; a dead <img> renders as
        // a broken-image glyph, which looks worse than never having tried.
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A stored slug, in the reader's language. Legacy free text passes through. */
const relLabel = (rel?: string) => {
  if (!rel) return "";
  const key = `settings.whatsapp.rel_${rel}`;
  const label = t(key as Parameters<typeof t>[0]);
  return label === key ? rel : label;
};

const roleLabel = (role?: string) => {
  const key = `settings.whatsapp.role_${role || "guest"}`;
  const label = t(key as Parameters<typeof t>[0]);
  // A custom role the owner invented has no translation; show it capitalised
  // rather than echoing the raw key back at them.
  return label === key ? (role || "").replace(/^\w/, (m) => m.toUpperCase()) : label;
};

/** Everything about one person, including the two actions with no undo. */
function ContactDialog({
  contact, roles, relationships, capabilities, isOwner, onClose, onSaved,
}: {
  contact: WhatsAppContact;
  roles: string[];
  relationships: string[];
  capabilities: string[];
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState<WhatsAppContact>(contact);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "remove">(null);

  const set = (k: keyof WhatsAppContact) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await WhatsApp.contacts.patch(contact.jid, {
        name: form.name, nickname: form.nickname, relationship: form.relationship,
        bio: form.bio, rules: form.rules, role: form.role,
        capabilities: form.capabilities, facts: form.facts,
      });
      await onSaved();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={`${isOwner ? "★ " : ""}${form.name || shortJid(contact.jid)}`}
        description={isOwner
          ? `${shortJid(contact.jid)} · ${t("settings.whatsapp.is_owner_note")}`
          : shortJid(contact.jid)}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm("remove")}>{t("settings.whatsapp.remove")}</Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button onClick={() => void save()} loading={busy}>{t("common.save")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("settings.whatsapp.name")}>
              <Input value={form.name || ""} onChange={(e) => set("name")(e.currentTarget.value)} />
            </Field>
            <Field label={t("settings.whatsapp.nickname")}>
              <Input value={form.nickname || ""} onChange={(e) => set("nickname")(e.currentTarget.value)} />
            </Field>
            <Field label={t("settings.whatsapp.relationship")}>
              <UiSelect
                value={form.relationship || ""}
                onChange={(v) => setForm((f) => ({ ...f, relationship: v }))}
                placeholder="—"
                options={relationships.map((r) => ({
                  value: r,
                  label: t(`settings.whatsapp.rel_${r}` as Parameters<typeof t>[0]),
                }))}
              />
            </Field>
          </div>

          <Field label={t("settings.whatsapp.role")}>
            <UiSelect
              value={form.role || "guest"}
              onChange={(v) => setForm((f) => ({ ...f, role: v }))}
              options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
            />
          </Field>

          <Field label={t("settings.whatsapp.bio")} hint={t("settings.whatsapp.bio_hint")}>
            <Textarea rows={2} value={form.bio || ""} onChange={(e) => set("bio")(e.currentTarget.value)} />
          </Field>

          <Field label={t("settings.whatsapp.rules")} hint={t("settings.whatsapp.rules_hint")}>
            <Textarea rows={3} value={form.rules || ""} onChange={(e) => set("rules")(e.currentTarget.value)} />
          </Field>

          <Field label={t("settings.whatsapp.capabilities")} hint={t("settings.whatsapp.capabilities_hint")}>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {capabilities.map((cap) => (
                <Switch
                  key={cap}
                  checked={form.capabilities?.[cap] === true}
                  onChange={(v) => setForm((f) => ({ ...f, capabilities: { ...(f.capabilities || {}), [cap]: v } }))}
                  label={t(`settings.whatsapp.cap_${cap}` as Parameters<typeof t>[0])}
                />
              ))}
            </div>
          </Field>

          {form.capabilities?.facts === true && (
            <Field label={t("settings.whatsapp.facts")} hint={t("settings.whatsapp.facts_hint")}>
              <Textarea rows={3} value={form.facts || ""} onChange={(e) => set("facts")(e.currentTarget.value)} />
            </Field>
          )}

        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm === "remove"}
        onClose={() => setConfirm(null)}
        title={t("settings.whatsapp.remove")}
        description={t("settings.whatsapp.remove_confirm")}
        confirmLabel={t("settings.whatsapp.remove")}
        onConfirm={async () => {
          try {
            await WhatsApp.contacts.remove(contact.jid);
            await onSaved();
            onClose();
          } catch (e) { toast.error((e as Error).message); }
        }}
      />
    </>
  );
}

// ── Pending ─────────────────────────────────────────────────────────────────
//
// What people asked for, waiting on a decision. Nothing here happened: the
// conversation that produced these has no tools and books nothing. The capture
// deliberately kept the sender's WORDS about timing ("mañana a la tarde") and
// never resolved them into a date — that resolution is made here, by a person
// with a calendar in front of them, not by a model hours earlier.

function PendingRequests() {
  const toast = useToast();
  const [rows, setRows] = useState<WhatsAppSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<WhatsAppSuggestion | null>(null);

  const refresh = useCallback(async () => {
    try { setRows((await WhatsApp.suggestions.list()).suggestions || []); }
    catch { /* daemon down */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  // Nothing waiting is the normal state, and an empty box saying so on top of
  // the roster is a permanent piece of furniture for an occasional event.
  if (loading || rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("settings.whatsapp.pending")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.whatsapp.pending_hint")}</p>
      {(
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Badge tone={r.kind === "appointment" ? "info" : "muted"}>
                {t(`settings.whatsapp.kind_${r.kind}` as Parameters<typeof t>[0])}
              </Badge>
              <span className="text-sm font-medium">{r.from_name}</span>
              <span className="text-sm text-muted-foreground">{r.summary}</span>
              {r.when_text && <span className="text-xs text-muted-foreground">· {r.when_text}</span>}
              {r.urgent && <Badge tone="warning">{t("settings.whatsapp.urgent")}</Badge>}
              <div className="ml-auto flex items-center gap-1">
                {r.kind === "appointment" && (
                  <Button variant="ghost" onClick={() => setBooking(r)}>
                    {t("settings.whatsapp.schedule")}
                  </Button>
                )}
                <Tip content={t("settings.whatsapp.mark_done")}>
                  <Button variant="ghost" className="size-7 p-0"
                    aria-label={t("settings.whatsapp.mark_done")}
                    onClick={() => act(() => WhatsApp.suggestions.confirm(r.id))}
                  ><Check size={14} /></Button>
                </Tip>
                <Tip content={t("settings.whatsapp.dismiss")}>
                  <Button variant="ghost" className="size-7 p-0"
                    aria-label={t("settings.whatsapp.dismiss")}
                    onClick={() => act(() => WhatsApp.suggestions.dismiss(r.id))}
                  ><X size={14} /></Button>
                </Tip>
              </div>
            </div>
          ))}
        </div>
      )}

      {booking && (
        <BookDialog
          suggestion={booking}
          onClose={() => setBooking(null)}
          onDone={async () => { await refresh(); setBooking(null); }}
        />
      )}
    </div>
  );
}

function BookDialog({
  suggestion, onClose, onDone,
}: { suggestion: WhatsAppSuggestion; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("settings.whatsapp.schedule")}
      description={`${suggestion.from_name} · ${suggestion.summary}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            loading={busy}
            disabled={!start}
            onClick={async () => {
              setBusy(true);
              try {
                await WhatsApp.suggestions.confirm(suggestion.id, {
                  start: new Date(start).toISOString(),
                  minutes: Number(minutes) || 60,
                });
                toast.success(t("settings.whatsapp.scheduled"));
                await onDone();
              } catch (e) { toast.error((e as Error).message); }
              finally { setBusy(false); }
            }}
          >{t("settings.whatsapp.schedule")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {suggestion.when_text && (
          <p className="text-xs text-muted-foreground">
            {t("settings.whatsapp.they_said")}: “{suggestion.when_text}”
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("settings.whatsapp.start")}>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
          </Field>
          <Field label={t("settings.whatsapp.minutes")}>
            <Input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.currentTarget.value)} />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("settings.whatsapp.schedule_hint")}</p>
      </div>
    </Dialog>
  );
}

// ── Stickers ────────────────────────────────────────────────────────────────

/** The WebP itself, fetched with the bearer header and revoked on unmount. */
function StickerImage({ sticker }: { sticker: WhatsAppSticker }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!sticker.has_image) return;
    let dead = false;
    let made: string | null = null;
    WhatsApp.stickers.imageUrl(sticker.key).then((u) => {
      if (dead) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      setUrl(u);
    }).catch(() => {});
    // Blob URLs are held by the document until revoked; a list that mounts and
    // unmounts would leak one per sticker per visit.
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [sticker.key, sticker.has_image]);

  // A square tile, because that is what a sticker IS — the card is built around
  // the picture, and a picture you have to squint at defeats the point of a
  // library you pick from on sight.
  if (url) {
    return (
      <img
        src={url}
        alt={sticker.meaning}
        className={cn(
          "aspect-square w-full rounded-md object-contain p-2 transition-opacity",
          // A blocked sticker is still shown — the owner has to see which one
          // they blocked — but it reads as set aside rather than available.
          sticker.blocked && "opacity-35 grayscale",
        )}
      />
    );
  }
  return (
    <span className="grid aspect-square w-full place-items-center rounded-md bg-muted p-2 text-center text-[10px] leading-tight text-muted-foreground">
      {sticker.has_image ? "…" : t("settings.whatsapp.no_sticker_image")}
    </span>
  );
}

/**
 * One sticker: the picture, what it means, and the two things you can do to it.
 *
 * The meaning is TEXT until you click it, not a permanently open input. A card
 * is ~12rem wide and these descriptions are a dozen words, so an input showed
 * "Hyped Lionel Messi h" and hid the rest behind a scroll nobody would find.
 * Clamped to two lines with the full wording in a tooltip, it reads; clicking
 * turns it into the editor it always was.
 */
function StickerCard({
  sticker: s,
  onChanged,
  onDelete,
}: {
  sticker: WhatsAppSticker;
  onChanged: (fn: () => Promise<unknown>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <StickerImage sticker={s} />

      {editing ? (
        <Textarea
          autoFocus
          rows={3}
          className="text-xs leading-snug"
          defaultValue={s.meaning}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            setEditing(false);
            if (!v || v === s.meaning) return;
            onChanged(() => WhatsApp.stickers.rename(s.key, v));
          }}
          // Enter saves, Escape abandons — a three-line box for one phrase does
          // not need a newline more than it needs a way out.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { e.currentTarget.value = s.meaning; e.currentTarget.blur(); }
          }}
        />
      ) : (
        <Tip content={s.meaning}>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={t("settings.whatsapp.sticker_edit_meaning")}
            className="line-clamp-2 min-h-[2.25rem] rounded text-left text-xs leading-snug text-foreground [overflow-wrap:anywhere] hover:text-brand"
          >
            {s.meaning}
          </button>
        </Tip>
      )}

      {/* Both facts shrink rather than push each other out of the card: the
          count was sitting outside the border, over the next card along. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge tone={s.meaning_source === "owner" ? "success" : "muted"} className="min-w-0 truncate">
          {s.meaning_source === "owner"
            ? t("settings.whatsapp.sticker_owner_source")
            : t("settings.whatsapp.sticker_vision_source")}
        </Badge>
        {s.blocked && <Badge tone="warning" className="shrink-0">{t("settings.whatsapp.sticker_blocked")}</Badge>}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {t("settings.whatsapp.seen", { count: s.count ?? 1 })}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Blocking is reversible and keeps the meaning; deleting is neither.
            They sit side by side so the softer one is the obvious first reach. */}
        <Tip content={t(s.blocked ? "settings.whatsapp.sticker_unblock_hint" : "settings.whatsapp.sticker_block_hint")}>
          <Button
            variant="ghost"
            className="h-7 min-w-0 flex-1 gap-1.5 px-2 text-xs"
            onClick={() => onChanged(() => WhatsApp.stickers.setBlocked(s.key, !s.blocked))}
          >
            {s.blocked ? <Check size={13} className="shrink-0" /> : <Ban size={13} className="shrink-0" />}
            <span className="truncate">
              {t(s.blocked ? "settings.whatsapp.sticker_unblock" : "settings.whatsapp.sticker_block")}
            </span>
          </Button>
        </Tip>
        <Tip content={t("settings.whatsapp.sticker_delete_hint")}>
          <Button
            variant="ghost"
            className="size-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            aria-label={t("settings.whatsapp.sticker_delete")}
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        </Tip>
      </div>
    </div>
  );
}

function StickersPanel() {
  const toast = useToast();
  const [stickers, setStickers] = useState<WhatsAppSticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<WhatsAppSticker | null>(null);

  const refresh = useCallback(async () => {
    try { setStickers((await WhatsApp.stickers.list()).stickers || []); }
    catch { /* daemon down */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await refresh(); }
    catch (err) { toast.error((err as Error).message); }
  }, [refresh, toast]);

  if (loading) return <Loading />;

  return (
    <Section title={t("settings.whatsapp.stickers")} description={t("settings.whatsapp.stickers_hint")}>
      {stickers.length === 0 ? (
        <Empty>{t("settings.whatsapp.no_stickers")}</Empty>
      ) : (
        // A grid, not a list. Every row was a 48px thumbnail beside a long
        // sentence, which is a table of descriptions — and you do not recognise
        // a sticker from its description, you recognise it on sight. Columns of
        // square cards put the picture first and let the words sit under it.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
          {stickers.map((s) => (
            <StickerCard
              key={s.key}
              sticker={s}
              onChanged={(fn) => void act(fn)}
              onDelete={() => setConfirmDelete(s)}
            />
          ))}
        </div>
      )}

      {/* Asked for, always. A sticker is somebody's bytes and there is no undo —
          and a delete that fires on the click that reached for block is exactly
          the mistake this page has already made once. */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t("settings.whatsapp.sticker_delete")}
        description={t("settings.whatsapp.sticker_delete_confirm", { meaning: confirmDelete?.meaning || "" })}
        confirmLabel={t("settings.whatsapp.sticker_delete")}
        destructive
        onConfirm={async () => {
          const s = confirmDelete;
          setConfirmDelete(null);
          if (s) await act(() => WhatsApp.stickers.remove(s.key));
        }}
      />
    </Section>
  );
}

const shortJid = (jid: string) => String(jid || "").split("@")[0].split(":")[0];
