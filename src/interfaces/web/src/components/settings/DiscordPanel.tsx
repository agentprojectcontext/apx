import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Camera, Loader2, RefreshCw } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Field, Input, Loading, Switch, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { Discord, type DiscordMode, type DiscordRoom, type DiscordStatus } from "../../lib/api/discord";
import { t } from "../../i18n";
import { usePersonaName } from "../../hooks/usePersonaName";

const MODES: DiscordMode[] = ["read", "mention", "useful", "always"];

// The select's value for a room that is not on the list. Not a mode: choosing
// it removes the room, and the bot stops reading it altogether.
const OFF = "off";

interface RoomRow {
  id: string;
  name: string | null;
  guild: string | null;
  category: string | null;
  mode: DiscordMode | null;
  /** Listed, but the server no longer shows it to the bot. */
  missing: boolean;
}

// Mirror KNOWLEDGE_MAX_CHARS / REPLY_WHEN_MAX_CHARS in core/channels/discord/config.js.
const KNOWLEDGE_MAX = 12_000;
const REPLY_WHEN_MAX = 2_000;
const RULES_MAX = 2_000;

// Snowflakes are digits. Checked here too so a pasted "#general" says what is
// wrong under the field instead of as a 400 in a toast.
const isSnowflake = (s: string) => /^\d{15,21}$/.test(s.trim());

// Permissions the invite asks for: View Channels, Send Messages, Read Message
// History, Send Messages in Threads — and nothing that moderates or manages.
const INVITE_PERMISSIONS = String((1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 38n));

const inviteUrl = (botId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot&permissions=${INVITE_PERMISSIONS}`;

/**
 * Any picture the owner picks → a 512×512 PNG data URL, cropped to a centred
 * square. Discord shows avatars round and small; sending the original photo
 * would only cost the upload (and trip the daemon's body limit).
 */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  return canvas.toDataURL("image/png");
}

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
  const persona = usePersonaName();
  const { data, isLoading, mutate } = useSWR<DiscordStatus>("/api/discord/status", () => Discord.status(), {
    refreshInterval: 5_000,
  });
  const [token, setToken] = useState("");
  const [owners, setOwners] = useState("");
  const [names, setNames] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [replyWhen, setReplyWhen] = useState("");
  const [rules, setRules] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [onlyIncluded, setOnlyIncluded] = useState(false);

  const connected = data?.state === "connected";
  const { data: roomsData, mutate: mutateRooms } = useSWR<{ rooms: DiscordRoom[] }>(
    connected ? "/api/discord/rooms" : null,
    () => Discord.rooms(),
    { refreshInterval: 15_000 },
  );
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const loaded = !!data;
  useEffect(() => {
    if (!data) return;
    setOwners(data.owner_ids.join(", "));
    setNames(data.names.join(", "));
    setKnowledge(data.knowledge || "");
    setReplyWhen(data.reply_when || "");
    setRules(data.rules || "");
    setEnabled(data.enabled);
    // Only on first load: the 5 s poll must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (isLoading || !data) return <Loading />;

  // Least to most talkative, after "not included".
  const modeOptions = (["read", "mention", "useful", "always"] as DiscordMode[]).map((m) => ({ value: m, label: t(`settings.discord.mode_${m}`) }));
  const offOption = { value: OFF, label: t("settings.discord.mode_off") };
  const ownersBad = splitList(owners).filter((x) => !isSnowflake(x));
  const tooLong = knowledge.length > KNOWLEDGE_MAX || replyWhen.length > REPLY_WHEN_MAX || rules.length > RULES_MAX;
  const includedCount = data.channels.length;
  const guildNames = [...new Set((roomsData?.rooms || []).map((r) => r.guild).filter(Boolean))];
  // What Discord says about the bot right now — the header's one line.
  const summary = !data.has_token
    ? t("settings.discord.summary_no_token")
    : !connected
      ? (data.error || t(`settings.discord.state_${data.state}`))
      : data.guilds === 0
        ? t("settings.discord.summary_no_server", { name: data.bot?.name || "" })
        : t("settings.discord.summary_connected", {
            name: data.bot?.name || "",
            servers: guildNames.join(", ") || String(data.guilds ?? 0),
            n: includedCount,
          });

  const save = async () => {
    setBusy(true);
    try {
      const reconnect = !!token.trim() || enabled !== data.enabled;
      await Discord.settings({
        ...(token.trim() ? { token: token.trim() } : {}),
        owner_ids: splitList(owners),
        names: splitList(names),
        knowledge: knowledge.trim(),
        reply_when: replyWhen.trim(),
        rules: rules.trim(),
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

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      await Discord.setAvatar(await toAvatarDataUrl(file));
      await mutate();
      toast.success(t("settings.discord.avatar_saved"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAvatarBusy(false);
      if (avatarInput.current) avatarInput.current.value = "";
    }
  };

  // One row per room: every text channel the bot can see, plus any room still
  // listed that the server no longer shows (deleted, or made private), so it
  // can be taken off the list.
  const serverRooms = roomsData?.rooms || [];
  const seen = new Set(serverRooms.map((r) => r.id));
  const rows: RoomRow[] = [
    ...serverRooms.map((r) => ({ id: r.id, name: r.name, guild: r.guild, category: r.category, mode: r.mode, missing: false })),
    ...data.channels
      .filter((c) => !seen.has(c.id))
      .map((c) => ({ id: c.id, name: c.name || null, guild: null, category: null, mode: c.mode, missing: connected && serverRooms.length > 0 })),
  ];
  const shown = onlyIncluded ? rows.filter((r) => r.mode) : rows;
  const groups = new Map<string, RoomRow[]>();
  for (const r of shown) {
    const key = r.missing ? t("settings.discord.not_visible") : [r.guild, r.category].filter(Boolean).join(" · ");
    groups.set(key, [...(groups.get(key) || []), r]);
  }

  const setRoom = async (row: RoomRow, value: string) => {
    try {
      if (value === OFF) {
        if (row.mode) await Discord.removeChannel(row.id);
      } else {
        await Discord.setChannel(row.id, { mode: value as DiscordMode, ...(row.name ? { name: row.name } : {}) });
      }
      await Promise.all([mutate(), mutateRooms()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2" data-testid="discord-panel">
      <Section
        title={t("settings.discord.title")}
        description={summary}
        action={(
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onChange={setEnabled} label={t("settings.discord.enabled")} />
            <Button variant="primary" loading={busy} disabled={ownersBad.length > 0 || tooLong} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        )}
      >
        <div className="grid gap-6 md:grid-cols-[10rem_1fr]">
        <div className="flex flex-col items-center gap-2 text-center" data-testid="discord-state">
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => changeAvatar(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={!connected || avatarBusy}
            onClick={() => avatarInput.current?.click()}
            aria-label={t("settings.discord.change_avatar")}
            title={connected ? t("settings.discord.change_avatar") : undefined}
            className="group relative h-28 w-28 overflow-hidden rounded-full border border-border bg-muted disabled:cursor-default"
          >
            {data.bot?.avatar_url
              ? <img src={data.bot.avatar_url.replace("size=128", "size=256")} alt="" className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center text-4xl font-semibold text-muted-foreground">
                  {(data.bot?.name || "?").slice(0, 1).toUpperCase()}
                </span>}
            {connected ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                {avatarBusy ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
                {t("settings.discord.change_avatar")}
              </span>
            ) : null}
            {avatarBusy ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                <Loader2 size={22} className="animate-spin" />
              </span>
            ) : null}
          </button>
          <div className="text-base font-semibold">{data.bot?.name || t("settings.discord.no_bot")}</div>
          <Badge tone={stateTone(data.state)}>{t(`settings.discord.state_${data.state}`)}</Badge>
          {data.has_token ? (
            <Button size="sm" onClick={reconnect}>
              <RefreshCw size={13} /> {t("settings.discord.reconnect")}
            </Button>
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
        </div>
        </div>

        <div className="mt-6 grid gap-4">
          <Field
            label={t("settings.discord.knowledge")}
            hint={t("settings.discord.knowledge_hint", { n: knowledge.length, max: KNOWLEDGE_MAX })}
            error={knowledge.length > KNOWLEDGE_MAX ? t("settings.discord.too_long", { max: KNOWLEDGE_MAX }) : undefined}
          >
            <Textarea
              rows={8}
              value={knowledge}
              placeholder={t("settings.discord.knowledge_placeholder", { persona })}
              onChange={(e) => setKnowledge(e.target.value)}
            />
          </Field>
          <Field
            label={t("settings.discord.rules")}
            hint={t("settings.discord.rules_hint", { n: rules.length, max: RULES_MAX })}
            error={rules.length > RULES_MAX ? t("settings.discord.too_long", { max: RULES_MAX }) : undefined}
          >
            <Textarea
              rows={5}
              value={rules}
              placeholder={t("settings.discord.rules_placeholder")}
              onChange={(e) => setRules(e.target.value)}
            />
          </Field>
          <Field
            label={t("settings.discord.reply_when")}
            hint={t("settings.discord.reply_when_hint", { n: replyWhen.length, max: REPLY_WHEN_MAX })}
            error={replyWhen.length > REPLY_WHEN_MAX ? t("settings.discord.too_long", { max: REPLY_WHEN_MAX }) : undefined}
          >
            <Textarea
              rows={4}
              value={replyWhen}
              placeholder={t("settings.discord.reply_when_placeholder")}
              onChange={(e) => setReplyWhen(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title={t("settings.discord.channels_title")}
        description={t("settings.discord.channels_subtitle")}
        filters={rows.length ? (
          <Switch checked={onlyIncluded} onChange={setOnlyIncluded} label={t("settings.discord.only_included")} />
        ) : undefined}
      >
        {connected && data.guilds === 0 ? (
          <p className="mb-3 text-[12px] text-muted-foreground">
            {t("settings.discord.rooms_need_invite")}{" "}
            {data.bot ? (
              <a className="text-primary underline" href={inviteUrl(data.bot.id)} target="_blank" rel="noreferrer">
                {t("settings.discord.invite")}
              </a>
            ) : null}
          </p>
        ) : !connected ? (
          <p className="mb-3 text-[12px] text-muted-foreground">{t("settings.discord.rooms_need_connection")}</p>
        ) : null}

        <div className="max-h-[32rem] overflow-auto rounded-md border border-border" data-testid="discord-channels">
          {shown.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("settings.discord.no_channels")}</p>
          ) : (
            [...groups.entries()].map(([heading, list]) => (
              <div key={heading || "rooms"}>
                {heading ? (
                  <div className="sticky top-0 z-10 border-b border-border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                    {heading}
                  </div>
                ) : null}
                <div className="divide-y divide-border">
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-2.5 py-1.5" data-testid={`discord-room-${r.id}`}>
                      <div className={`min-w-0 flex-1 ${r.mode ? "" : "opacity-55"}`}>
                        <div className="truncate text-sm">{r.name ? `#${r.name}` : r.id}</div>
                        {r.missing ? <div className="truncate text-[11px] text-muted-foreground">{t("settings.discord.not_visible_hint")}</div> : null}
                      </div>
                      <UiSelect
                        className="w-40"
                        value={r.mode || OFF}
                        onChange={(v) => setRoom(r, v)}
                        options={[offOption, ...modeOptions]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
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
