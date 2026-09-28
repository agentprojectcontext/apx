import { useEffect, useState } from "react";
import useSWR from "swr";
import { Trash2 } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Field, Input, Loading, Switch } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { Discord, type DiscordMode, type DiscordStatus } from "../../lib/api/discord";
import { t } from "../../i18n";

const MODES: DiscordMode[] = ["always", "mention", "read"];

// Snowflakes are digits. Checked here too so a pasted "#general" says what is
// wrong under the field instead of as a 400 in a toast.
const isSnowflake = (s: string) => /^\d{15,21}$/.test(s.trim());

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function stateTone(s: DiscordStatus["state"]) {
  if (s === "connected") return "success" as const;
  if (s === "error") return "danger" as const;
  if (s === "connecting" || s === "reconnecting") return "warning" as const;
  return "muted" as const;
}

/**
 * Settings → Discord. The bot's connection, and the rooms it lives in.
 *
 * The token goes in and never comes back: the daemon only reports whether one
 * is saved. Saving a new token (or flipping `enabled`) reconnects the bot on
 * the spot — no `apx restart`. Room modes apply to the next message.
 */
export function DiscordPanel() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<DiscordStatus>("/api/discord/status", () => Discord.status(), {
    refreshInterval: 5_000,
  });
  const [token, setToken] = useState("");
  const [owners, setOwners] = useState("");
  const [names, setNames] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<DiscordMode>("read");

  const loaded = !!data;
  useEffect(() => {
    if (!data) return;
    setOwners(data.owner_ids.join(", "));
    setNames(data.names.join(", "));
    setKnowledge(data.knowledge_path || "");
    setEnabled(data.enabled);
    // Only on first load: the 5 s poll must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (isLoading || !data) return <Loading />;

  const modeOptions = MODES.map((m) => ({ value: m, label: t(`settings.discord.mode_${m}`) }));
  const ownersBad = splitList(owners).filter((x) => !isSnowflake(x));

  const save = async () => {
    setBusy(true);
    try {
      const reconnect = !!token.trim() || enabled !== data.enabled;
      await Discord.settings({
        ...(token.trim() ? { token: token.trim() } : {}),
        owner_ids: splitList(owners),
        names: splitList(names),
        knowledge_path: knowledge.trim(),
        enabled,
      });
      if (reconnect) await Discord.reconnect();
      setToken("");
      await mutate();
      toast.success(reconnect ? t("settings.discord.saved_reconnecting") : t("settings.discord.saved"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    try {
      await Discord.reconnect();
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const setMode = async (id: string, mode: DiscordMode) => {
    try {
      await Discord.setChannel(id, { mode });
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await Discord.removeChannel(id);
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const add = async () => {
    try {
      await Discord.setChannel(newId.trim(), { mode: newMode, ...(newName.trim() ? { name: newName.trim().replace(/^#/, "") } : {}) });
      setNewId("");
      setNewName("");
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2" data-testid="discord-panel">
      <Section title={t("settings.discord.title")} description={t("settings.discord.subtitle")}>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="discord-state">
          <Badge tone={stateTone(data.state)}>{t(`settings.discord.state_${data.state}`)}</Badge>
          {data.bot ? <span className="text-muted-foreground">{data.bot.name}</span> : null}
          {data.error ? <span className="text-destructive">{data.error}</span> : null}
          {data.has_token ? (
            <Button size="sm" variant="ghost" onClick={reconnect}>{t("settings.discord.reconnect")}</Button>
          ) : null}
        </div>
        <div className="grid gap-3">
          <Field
            label={t("settings.discord.token")}
            hint={data.has_token ? t("settings.discord.token_saved_hint") : t("settings.discord.token_hint")}
          >
            <Input
              type="password"
              autoComplete="off"
              value={token}
              placeholder={data.has_token ? t("settings.discord.token_saved") : ""}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          <Field
            label={t("settings.discord.owner_ids")}
            hint={t("settings.discord.owner_ids_hint")}
            error={ownersBad.length ? t("settings.discord.bad_id", { id: ownersBad[0] }) : undefined}
          >
            <Input value={owners} placeholder="1234567890123456789" onChange={(e) => setOwners(e.target.value)} />
          </Field>
          <Field label={t("settings.discord.names")} hint={t("settings.discord.names_hint")}>
            <Input value={names} placeholder="roby" onChange={(e) => setNames(e.target.value)} />
          </Field>
          <Field label={t("settings.discord.knowledge")} hint={t("settings.discord.knowledge_hint")}>
            <Input value={knowledge} placeholder="/path/to/about.md" onChange={(e) => setKnowledge(e.target.value)} />
          </Field>
          <Switch checked={enabled} onChange={setEnabled} label={t("settings.discord.enabled")} />
        </div>
        <div className="mt-4">
          <Button variant="primary" loading={busy} disabled={ownersBad.length > 0} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </Section>

      <Section title={t("settings.discord.channels_title")} description={t("settings.discord.channels_subtitle")}>
        <div className="divide-y divide-border rounded-md border border-border" data-testid="discord-channels">
          {data.channels.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("settings.discord.no_channels")}</p>
          ) : (
            data.channels.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name ? `#${c.name}` : c.id}</div>
                  {c.name ? <div className="truncate font-mono text-[11px] text-muted-foreground">{c.id}</div> : null}
                </div>
                <UiSelect
                  className="w-44"
                  value={c.mode}
                  onChange={(v) => setMode(c.id, v as DiscordMode)}
                  options={modeOptions}
                />
                <Button size="sm" variant="ghost" aria-label={t("settings.discord.remove")} onClick={() => remove(c.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field
            label={t("settings.discord.channel_id")}
            error={newId && !isSnowflake(newId) ? t("settings.discord.bad_id", { id: newId }) : undefined}
          >
            <Input value={newId} placeholder="1234567890123456789" onChange={(e) => setNewId(e.target.value)} />
          </Field>
          <Field label={t("settings.discord.channel_name")}>
            <Input value={newName} placeholder="general" onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <UiSelect className="w-44" value={newMode} onChange={(v) => setNewMode(v as DiscordMode)} options={modeOptions} />
        </div>
        <div className="mt-3">
          <Button onClick={add} disabled={!isSnowflake(newId)}>{t("settings.discord.add_channel")}</Button>
        </div>

        <ul className="mt-4 space-y-1 text-[12px] text-muted-foreground">
          {MODES.map((m) => (
            <li key={m}><span className="font-medium text-foreground">{t(`settings.discord.mode_${m}`)}</span> — {t(`settings.discord.mode_${m}_hint`)}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
