import type { ChannelEmail, MailServer } from "@apx/protocol";
import { Button, Icons, Input, Select, SettingRow, Switch, TagInput } from "@apx/ui";
import { useState } from "react";
import { EmailSignatures } from "../../config/EmailSignatures.tsx";
import type { ChannelDraft } from "../../data/channels.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { ConnectionCard, OwnerLink } from "./parts.tsx";
import type { Create, PaneProps } from "./types.ts";

/** Known providers: their servers, and the address domains that point to them. */
const PROVIDERS = {
  gmail: {
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.gmail.com", port: 465, tls: "implicit" },
  },
  outlook: {
    name: "Outlook",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    imap: { host: "outlook.office365.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.office365.com", port: 587, tls: "starttls" },
  },
  icloud: {
    name: "iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: "starttls" },
  },
  yahoo: {
    name: "Yahoo",
    domains: ["yahoo.com", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: "implicit" },
  },
  fastmail: {
    name: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    imap: { host: "imap.fastmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.fastmail.com", port: 465, tls: "implicit" },
  },
} as const satisfies Record<string, { name: string; domains: string[]; imap: MailServer; smtp: MailServer }>;
type Provider = keyof typeof PROVIDERS | "other";

const ADDRESS = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const providerOf = (address: string): Provider | undefined => {
  const domain = address.split("@")[1]?.trim().toLowerCase();
  const hit = Object.entries(PROVIDERS).find(([, p]) => (p.domains as readonly string[]).includes(domain ?? ""));
  return hit?.[0] as Provider | undefined;
};
const sameServer = (a: MailServer, b: MailServer) => a.host === b.host && a.port === b.port && a.tls === b.tls;

/** The mailbox's settings as typed: a provider fills the servers, "Other" shows them. */
function useMailForm(initial?: ChannelEmail) {
  const known = initial
    ? (Object.entries(PROVIDERS).find(
        ([, p]) => sameServer(p.imap, initial.imap) && sameServer(p.smtp, initial.smtp),
      )?.[0] as Provider | undefined)
    : undefined;
  const [address, setAddress] = useState(initial?.address ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [picked, setPicked] = useState<Provider | undefined>(initial ? (known ?? "other") : undefined);
  const [imap, setImap] = useState<MailServer>(initial?.imap ?? { host: "", port: 993, tls: "implicit" });
  const [smtp, setSmtp] = useState<MailServer>(initial?.smtp ?? { host: "", port: 465, tls: "implicit" });
  const provider = picked ?? providerOf(address) ?? "other";
  const servers = provider === "other" ? { imap, smtp } : PROVIDERS[provider];
  const ok = ADDRESS.test(address.trim()) && Boolean(servers.imap.host) && Boolean(servers.smtp.host);
  const value = (): Omit<ChannelEmail, "allowed" | "trust_unverified" | "mailbox"> => ({
    address: address.trim().toLowerCase(),
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(provider === "other" && username.trim() ? { username: username.trim() } : {}),
    imap: { ...servers.imap },
    smtp: { ...servers.smtp },
  });
  return {
    address,
    setAddress,
    name,
    setName,
    username,
    setUsername,
    provider,
    setPicked,
    imap,
    setImap,
    smtp,
    setSmtp,
    ok,
    value,
  };
}

function MailForm({ form }: { form: ReturnType<typeof useMailForm> }) {
  const t = useT();
  const agentName = useData((s) => Object.values(s.agents).find((a) => a.kind === "secretary")?.name);
  const providers: Provider[] = [...(Object.keys(PROVIDERS) as Provider[]), "other"];
  return (
    <>
      <div className="pform__field">
        <span className="pform__label">{t("em.address")}</span>
        <Input
          aria-label={t("em.address")}
          type="email"
          autoComplete="off"
          placeholder="agent@example.org"
          value={form.address}
          onChange={(e) => form.setAddress(e.currentTarget.value)}
        />
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("em.provider")}</span>
        <div className="pform__presets">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={`pform__preset${form.provider === p ? " is-on" : ""}`}
              onClick={() => form.setPicked(p)}
            >
              {p === "other" ? t("em.other") : PROVIDERS[p].name}
            </button>
          ))}
        </div>
      </div>
      {form.provider === "other" && (
        <>
          <ServerFields title={t("em.imap")} value={form.imap} onChange={form.setImap} />
          <ServerFields title={t("em.smtp")} value={form.smtp} onChange={form.setSmtp} />
          <div className="pform__field">
            <span className="pform__label">{t("em.username")}</span>
            <Input
              aria-label={t("em.username")}
              autoComplete="off"
              placeholder={form.address || "agent@example.org"}
              value={form.username}
              onChange={(e) => form.setUsername(e.currentTarget.value)}
            />
            <span className="pform__hint">{t("em.usernameHint")}</span>
          </div>
        </>
      )}
      <div className="pform__field">
        <span className="pform__label">{t("em.name")}</span>
        <Input
          aria-label={t("em.name")}
          autoComplete="off"
          placeholder={agentName}
          value={form.name}
          onChange={(e) => form.setName(e.currentTarget.value)}
        />
      </div>
    </>
  );
}

function ServerFields({ title, value, onChange }: { title: string; value: MailServer; onChange(v: MailServer): void }) {
  const t = useT();
  return (
    <div className="pform__field">
      <span className="pform__label">{title}</span>
      <div className="emailsrv">
        <Input
          aria-label={`${title} · ${t("em.host")}`}
          autoComplete="off"
          placeholder="mail.example.org"
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.currentTarget.value.trim() })}
        />
        <Input
          aria-label={`${title} · ${t("em.port")}`}
          inputMode="numeric"
          className="emailsrv__port"
          value={String(value.port)}
          onChange={(e) => onChange({ ...value, port: Number(e.currentTarget.value.replace(/\D/g, "")) || 0 })}
        />
        <Select
          size="sm"
          label={`${title} · ${t("em.security")}`}
          value={value.tls}
          onValueChange={(v) => v && onChange({ ...value, tls: v as MailServer["tls"] })}
          options={(["implicit", "starttls", "none"] as const).map((k) => ({ value: k, label: t(`em.tls.${k}`) }))}
        />
      </div>
    </div>
  );
}

/** Email: connect a mailbox, choose who answers and who may write, see what went out. */
/** A new mailbox: its address and provider (or servers), its password, and Connect, which makes the account. */
export function EmailConnect({ create }: { create: Create }) {
  const t = useT();
  const form = useMailForm();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await create(
      {
        label: form.address.trim().slice(0, 60),
        email: { ...form.value(), mailbox: "INBOX", allowed: [], trust_unverified: false },
      },
      password,
    );
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <ol className="tgsetup__steps">
        {(["em.step1", "em.step2", "em.step3"] as const).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      <MailForm form={form} />
      <div className="pform__field">
        <span className="pform__label">{t("em.password")}</span>
        <Input
          aria-label={t("em.password")}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <span className="pform__hint">{t("em.passwordStored")}</span>
      </div>
      <div>
        <Button disabled={!form.ok || password.length < 8} loading={busy} onClick={() => void connect()}>
          {t("acct.connect")}
        </Button>
      </div>
    </div>
  );
}

/** A mailbox's connection: its state and password, whose mail it takes, its servers and its signatures. */
export function EmailAccount(pane: PaneProps) {
  const t = useT();
  const { channel, draft, set, saveNow } = pane;
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const email = draft.email;
  const fixPassword = channel.status === "error" || !channel.token_set;
  const savePassword = async () => {
    if (password.length < 8 || !(await saveNow(password))) return;
    setPassword("");
    setChangingPassword(false);
    notify(t("em.saved"), "info");
  };
  const passwordField = (
    <div className="tgtoken">
      <Input
        aria-label={t("em.password")}
        type="password"
        autoComplete="off"
        placeholder={t("em.password")}
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && void savePassword()}
      />
      <Button size="sm" variant="secondary" disabled={password.length < 8} onClick={() => void savePassword()}>
        {t("common.save")}
      </Button>
    </div>
  );
  return (
    <>
      <ConnectionCard {...pane}>
        {fixPassword && (
          <div className="tgcard__fix">
            <span className="tgcard__fixlabel">{t("em.passwordFix")}</span>
            {passwordField}
          </div>
        )}
      </ConnectionCard>
      {!fixPassword && (
        <SettingRow title={t("em.password")} description={t("em.passwordStored")}>
          {changingPassword ? (
            passwordField
          ) : (
            <div className="tgtoken">
              <code className="tgtoken__hint">{channel.token_hint ?? "••••"}</code>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Pencil size={14} />}
                onClick={() => setChangingPassword(true)}
              >
                {t("em.passwordChange")}
              </Button>
            </div>
          )}
        </SettingRow>
      )}
      {email && (
        <>
          <SettingRow title={t("em.allowed")} description={t("em.allowedHint")}>
            <TagInput
              label={t("em.allowed")}
              className="emailallowed"
              max={50}
              placeholder={t("em.allowedPlaceholder")}
              value={email.allowed}
              onValueChange={(allowed) => set({ email: { ...email, allowed } })}
            />
          </SettingRow>
          <SettingRow title={t("em.unverified")} description={t("em.unverifiedHint")}>
            <Switch
              size="sm"
              checked={email.trust_unverified}
              onCheckedChange={(on) => set({ email: { ...email, trust_unverified: on } })}
              aria-label={t("em.unverified")}
            />
          </SettingRow>
          <SettingRow title={t("em.servers")} description={t("em.serversHint")}>
            <div className="tgtoken">
              <code className="tgtoken__hint">
                {email.imap.host} · {email.smtp.host}
              </code>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Pencil size={14} />}
                onClick={() => setEditing((v) => !v)}
              >
                {t("em.edit")}
              </Button>
            </div>
          </SettingRow>
          {editing && <EditServers email={email} set={set} done={() => setEditing(false)} />}
        </>
      )}
      <OwnerLink channelId={channel.id} name="Email" />
      {channel.email && (
        <EmailSignatures
          target={{ transport: "smtp", account: channel.id, sender: channel.email.address, label: channel.label }}
        />
      )}
    </>
  );
}

function EditServers({
  email,
  set,
  done,
}: {
  email: ChannelEmail;
  set(patch: Partial<ChannelDraft>): void;
  done(): void;
}) {
  const t = useT();
  const form = useMailForm(email);
  const apply = () => {
    const kept = { mailbox: email.mailbox, allowed: email.allowed, trust_unverified: email.trust_unverified };
    set({ email: { ...kept, ...form.value() } });
    done();
  };
  return (
    <div className="tgsetup emailedit">
      <MailForm form={form} />
      <div className="tgtoken">
        <Button size="sm" variant="ghost" onClick={done}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" variant="secondary" disabled={!form.ok} onClick={apply}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
