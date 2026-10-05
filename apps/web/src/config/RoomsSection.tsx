import type { ChannelInfo, ChannelRooms, RoomMode } from "@apx/protocol";
import { Button, Icons, Input, Select, SettingRow, Switch, Textarea } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
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

/**
 * The server rooms a Discord bot reads and may speak in, each with its mode; the words that call it, the owner's notes
 * for that community, its rules and limits. A room not listed does not exist for APX.
 */
export function RoomsSection({ channel, save }: { channel: ChannelInfo; save(rooms: ChannelRooms): Promise<unknown> }) {
  const t = useT();
  const cur = channel.rooms ?? EMPTY;
  const set = (patch: Partial<ChannelRooms>) => void save({ ...cur, ...patch });
  const [adding, setAdding] = useState({ id: "", name: "" });
  const validId = /^\d{15,21}$/.test(adding.id.trim());
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
      <SubHead>{t("rooms.title")}</SubHead>
      <p className="pform__hint">{t("rooms.lead")}</p>
      <div className="rooms">
        {cur.rooms.map((r) => (
          <div key={r.id} className="rooms__row">
            <span className="rooms__name">#{r.name || r.id}</span>
            <code className="rooms__id">{r.id}</code>
            <Select
              label={t("rooms.mode", { room: r.name || r.id })}
              value={r.mode}
              onValueChange={(v) =>
                v && set({ rooms: cur.rooms.map((x) => (x.id === r.id ? { ...x, mode: v as RoomMode } : x)) })
              }
              options={MODES.map((m) => ({ value: m, label: t(`rooms.mode.${m}`) }))}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("rooms.remove", { room: r.name || r.id })}
              leadingIcon={<Icons.Trash2 size={14} />}
              onClick={() => set({ rooms: cur.rooms.filter((x) => x.id !== r.id) })}
            />
          </div>
        ))}
        <div className="rooms__row rooms__add">
          <Input
            aria-label={t("rooms.name")}
            className="rooms__addname"
            placeholder={t("rooms.namePlaceholder")}
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.currentTarget.value })}
          />
          <Input
            aria-label={t("rooms.id")}
            className="rooms__addid"
            placeholder={t("rooms.idPlaceholder")}
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
        <p className="pform__hint">{t("rooms.idHint")}</p>
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
