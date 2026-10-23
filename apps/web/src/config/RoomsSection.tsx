import type { ChannelInfo, ChannelRooms, RoomMode } from "@apx/protocol";
import { Button, Icons, Input, Select, SettingRow, Switch, Tag, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

const MODES: RoomMode[] = ["mention", "useful", "always", "read"];
const EMPTY: ChannelRooms = {
  rooms: [],
  names: [],
  owner_only: false,
  knowledge: "",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 20, room_replies_per_hour: 30, checks_per_hour: 120 },
};

type ServerRoom = { id: string; name: string; server: string; writable: boolean };
const ROOMS_KINDS = ["discord", "telegram", "googlechat", "nextcloud", "irc", "twitch", "teams", "line"] as const;
type RoomsKind = (typeof ROOMS_KINDS)[number];
export const isRoomsKind = (k: string): k is RoomsKind => (ROOMS_KINDS as readonly string[]).includes(k);

/**
 * A Discord channel id; a Telegram group's id (negative, -100… for a supergroup); a Google Chat space; a Nextcloud
 * Talk conversation's token; an IRC channel; a Twitch chat (the streamer's #login); a Teams channel or group chat; a
 * LINE group (C…) or multi-person chat (R…).
 */
const ROOM_ID: Record<RoomsKind, RegExp> = {
  discord: /^\d{15,21}$/,
  telegram: /^-\d{5,16}$/,
  googlechat: /^spaces\/[\w-]+$/,
  nextcloud: /^[a-z0-9]{4,32}$/,
  irc: /^[#&][^\s,]{1,39}$/,
  twitch: /^#\w{3,25}$/,
  teams: /^19:\S{8,116}$/,
  line: /^[CR][0-9a-f]{32}$/,
};
/** The rooms of the platforms that report them as the bot sees them, like Telegram's groups. */
const SEEN = {
  title: "rooms.any.title",
  lead: "rooms.any.lead",
  pick: "rooms.any.pick",
  allListed: "rooms.any.allListed",
  namePlaceholder: "rooms.tg.namePlaceholder",
  idPlaceholder: "rooms.any.idPlaceholder",
  idHint: "rooms.any.idHint",
} as const;
/** The texts that name the platform's rooms: Discord's server rooms, Telegram's groups. */
const WORDS = {
  discord: {
    title: "rooms.title",
    lead: "rooms.lead",
    pick: "rooms.pick",
    allListed: "rooms.allListed",
    namePlaceholder: "rooms.namePlaceholder",
    idPlaceholder: "rooms.idPlaceholder",
    idHint: "rooms.idHint",
  },
  telegram: {
    title: "rooms.tg.title",
    lead: "rooms.tg.lead",
    pick: "rooms.tg.pick",
    allListed: "rooms.tg.allListed",
    namePlaceholder: "rooms.tg.namePlaceholder",
    idPlaceholder: "rooms.tg.idPlaceholder",
    idHint: "rooms.tg.idHint",
  },
  googlechat: SEEN,
  nextcloud: SEEN,
  irc: SEEN,
  twitch: SEEN,
  teams: SEEN,
  line: SEEN,
} as const satisfies Record<RoomsKind, Record<string, MessageKey>>;

/** The rooms of the bot's servers while it runs; none (and the id form) when they cannot be read. */
function useServerRooms(channel: ChannelInfo): ServerRoom[] | undefined {
  const [rooms, setRooms] = useState<ServerRoom[]>();
  const running = channel.status === "running";
  useEffect(() => {
    if (!running) return setRooms(undefined);
    let live = true;
    client.call("channels.rooms", { channel: channel.id }).then(
      (r) => live && setRooms(r.rooms),
      () => live && setRooms(undefined),
    );
    return () => {
      live = false;
    };
  }, [channel.id, running]);
  return rooms;
}

/**
 * The server rooms a Discord bot (or the groups a Telegram bot) reads and may speak in, each with its mode; the words
 * that call it, the owner's notes for that community, its rules and limits. A room not listed does not exist for APX.
 * Rooms are picked from the bot's servers (each says whether the bot may write there), or from the groups a Telegram
 * bot was seen in; typing an id is the fallback.
 */
export function RoomsSection({
  channel,
  kind,
  save,
}: {
  channel: ChannelInfo;
  kind: RoomsKind;
  save(rooms: ChannelRooms): Promise<unknown>;
}) {
  const t = useT();
  const words = WORDS[kind];
  // Telegram groups have no "#" in front of their names.
  const shown = (r: { id: string; name: string }) => (kind === "discord" ? `#${r.name || r.id}` : r.name || r.id);
  const cur = channel.rooms ?? EMPTY;
  const set = (patch: Partial<ChannelRooms>) => void save({ ...cur, ...patch });
  const [adding, setAdding] = useState({ id: "", name: "" });
  const server = useServerRooms(channel);
  const [byId, setById] = useState(false);
  const writable = new Map((server ?? []).map((r) => [r.id, r.writable]));
  const unlisted = (server ?? []).filter((r) => !cur.rooms.some((x) => x.id === r.id));
  const validId = ROOM_ID[kind].test(adding.id.trim());
  const add = () => {
    if (!validId || cur.rooms.some((r) => r.id === adding.id.trim())) return;
    set({
      rooms: [...cur.rooms, { id: adding.id.trim(), name: adding.name.trim().replace(/^#/, ""), mode: "mention" }],
    });
    setAdding({ id: "", name: "" });
  };
  const text = (key: "knowledge" | "rules" | "reply_when", max: number, rows: number, label: string) => (
    <Textarea
      key={`${key}:${cur[key]}`}
      aria-label={label}
      rows={rows}
      maxLength={max}
      defaultValue={cur[key]}
      onBlur={(e) => e.currentTarget.value !== cur[key] && set({ [key]: e.currentTarget.value })}
    />
  );
  return (
    <>
      <SubHead>{t(words.title)}</SubHead>
      <p className="pform__hint">{t(words.lead)}</p>
      {kind === "telegram" && <p className="pform__hint">{t("rooms.tg.privacy")}</p>}
      <div className="rooms">
        {cur.rooms.map((r) => (
          <div key={r.id} className="rooms__row">
            <span className="rooms__name">{shown(r)}</span>
            {writable.get(r.id) === false ? (
              <Tag className="rooms__mute" title={t("rooms.cannotWriteHint")}>
                {t("rooms.cannotWrite")}
              </Tag>
            ) : (
              <code className="rooms__id">{r.id}</code>
            )}
            <Select
              label={t("rooms.mode", { room: shown(r) })}
              value={r.mode}
              onValueChange={(v) =>
                v && set({ rooms: cur.rooms.map((x) => (x.id === r.id ? { ...x, mode: v as RoomMode } : x)) })
              }
              options={MODES.map((m) => ({
                value: m,
                label: t(`rooms.mode.${m}`),
                description: t(`rooms.modeHint.${m}`),
              }))}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("rooms.remove", { room: shown(r) })}
              leadingIcon={<Icons.Trash2 size={14} />}
              onClick={() => set({ rooms: cur.rooms.filter((x) => x.id !== r.id) })}
            />
          </div>
        ))}
        {server && (
          <div className="rooms__row rooms__add">
            <Select
              label={t(words.pick)}
              className="rooms__pick"
              value={null}
              placeholder={
                unlisted.length
                  ? t(words.pick)
                  : kind !== "discord" && !server.length
                    ? t(kind === "telegram" ? "rooms.tg.none" : "rooms.any.none")
                    : t(words.allListed)
              }
              disabled={!unlisted.length}
              onValueChange={(id) => {
                const r = unlisted.find((x) => x.id === id);
                if (r) set({ rooms: [...cur.rooms, { id: r.id, name: r.name, mode: "mention" }] });
              }}
              options={unlisted.map((r) => ({
                value: r.id,
                label: shown(r),
                ...(r.server ? { group: r.server } : {}),
                ...(r.writable ? {} : { description: t("rooms.cannotWriteHint") }),
              }))}
            />
            {!byId && (
              <Button size="sm" variant="ghost" onClick={() => setById(true)}>
                {t("rooms.byId")}
              </Button>
            )}
          </div>
        )}
        {(!server || byId) && (
          <div className="rooms__row rooms__add">
            <Input
              aria-label={t("rooms.name")}
              className="rooms__addname"
              placeholder={t(words.namePlaceholder)}
              value={adding.name}
              onChange={(e) => setAdding({ ...adding, name: e.currentTarget.value })}
            />
            <Input
              aria-label={t("rooms.id")}
              className="rooms__addid"
              placeholder={t(words.idPlaceholder)}
              value={adding.id}
              onChange={(e) => setAdding({ ...adding, id: e.currentTarget.value })}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Plus size={14} />}
              disabled={!validId}
              onClick={add}
            >
              {t("rooms.add")}
            </Button>
          </div>
        )}
        {(!server || byId || kind !== "discord") && <p className="pform__hint">{t(words.idHint)}</p>}
      </div>

      <SettingRow title={t("rooms.names")} description={t("rooms.namesHint")}>
        <Input
          key={cur.names.join(",")}
          aria-label={t("rooms.names")}
          className="rooms__names"
          placeholder="roby"
          defaultValue={cur.names.join(", ")}
          onBlur={(e) => {
            const names = e.currentTarget.value
              .split(",")
              .map((n) => n.trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 10);
            if (names.join(",") !== cur.names.join(",")) set({ names });
          }}
        />
      </SettingRow>
      <SettingRow title={t("rooms.ownerOnly")} description={t("rooms.ownerOnlyHint")}>
        <Switch
          size="sm"
          checked={cur.owner_only}
          onCheckedChange={(on) => set({ owner_only: on })}
          aria-label={t("rooms.ownerOnly")}
        />
      </SettingRow>
      <div className="pform__field">
        <span className="pform__label">{t("rooms.knowledge")}</span>
        {text("knowledge", 12_000, 6, t("rooms.knowledge"))}
        <span className="pform__hint">{t("rooms.knowledgeHint")}</span>
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("rooms.rules")}</span>
        {text("rules", 2000, 3, t("rooms.rules"))}
        <span className="pform__hint">{t("rooms.rulesHint")}</span>
      </div>
      {cur.rooms.some((r) => r.mode === "useful") && (
        <div className="pform__field">
          <span className="pform__label">{t("rooms.replyWhen")}</span>
          {text("reply_when", 2000, 3, t("rooms.replyWhen"))}
          <span className="pform__hint">{t("rooms.replyWhenHint")}</span>
        </div>
      )}
      <SettingRow title={t("rooms.limits")} description={t("rooms.limitsHint")}>
        <span className="rooms__limits">
          <Limit
            label={t("rooms.cooldown")}
            value={cur.limits.user_cooldown_s}
            max={3600}
            onSave={(v) => set({ limits: { ...cur.limits, user_cooldown_s: v } })}
          />
          <Limit
            label={t("rooms.perHour")}
            value={cur.limits.room_replies_per_hour}
            min={1}
            max={600}
            onSave={(v) => set({ limits: { ...cur.limits, room_replies_per_hour: v } })}
          />
        </span>
      </SettingRow>
    </>
  );
}

function Limit({
  label,
  value,
  min = 0,
  max,
  onSave,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onSave(v: number): void;
}) {
  return (
    <span className="rooms__limit">
      <Input
        key={value}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        className="nudge__num"
        defaultValue={String(value)}
        onBlur={(e) => {
          const v = Math.max(min, Math.min(max, Math.round(Number(e.currentTarget.value) || min)));
          if (v !== value) onSave(v);
        }}
      />
      <span className="pform__hint">{label}</span>
    </span>
  );
}
