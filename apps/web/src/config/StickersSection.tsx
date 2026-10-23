// The stickers people sent on a channel: whether new ones are the agent's to use as they come, what each one means to
// it (the owner may say it better), whether it may answer with it, and forgetting one. An adult one, or one no model
// could see, always waits for the owner's OK.
import type { Sticker } from "@apx/protocol";
import { Badge, IconButton, Icons, Input, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { useMediaUrl } from "../chat/parts/useMediaUrl.ts";
import { loadStickers, removeSticker, setSticker, setStickersAuto } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

export function Stickers({ platform, label }: { platform: string; label: string }) {
  const t = useT();
  const [list, setList] = useState<Sticker[]>();
  const [auto, setAuto] = useState<boolean>();
  useEffect(() => {
    let live = true;
    void loadStickers(platform).then((r) => {
      if (!live || !r) return;
      // The ones waiting for the owner first.
      setList([...r.stickers].sort((a, b) => Number(b.pending) - Number(a.pending)));
      setAuto(r.auto);
    });
    return () => {
      live = false;
    };
  }, [platform]);
  const replace = (s: Sticker) => setList((l) => l?.map((x) => (x.id === s.id ? s : x)));
  return (
    <>
      <SubHead>{t("stk.title")}</SubHead>
      <p className="config__lead">{t("stk.lead", { channel: label })}</p>
      {auto !== undefined && (
        <SettingRow title={t("stk.auto")} description={t("stk.autoHint")}>
          <Switch
            size="sm"
            checked={auto}
            aria-label={t("stk.auto")}
            onCheckedChange={async (on) => {
              const now = await setStickersAuto(on);
              if (now !== undefined) setAuto(now);
            }}
          />
        </SettingRow>
      )}
      {list && !list.length ? (
        <p className="res__desc">{t("stk.none", { channel: label })}</p>
      ) : (
        <ul className="res__list">
          {(list ?? []).map((s) => (
            <StickerRow
              key={s.id}
              sticker={s}
              onChange={replace}
              onRemove={() => setList((l) => l?.filter((x) => x.id !== s.id))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function StickerRow({
  sticker,
  onChange,
  onRemove,
}: {
  sticker: Sticker;
  onChange(s: Sticker): void;
  onRemove(): void;
}) {
  const t = useT();
  const url = useMediaUrl(sticker.mime.startsWith("image/") ? sticker.media_id : undefined);
  const [meaning, setMeaning] = useState(sticker.meaning ?? "");
  const save = async () => {
    const words = meaning.trim();
    if (!words || words === sticker.meaning) return setMeaning(sticker.meaning ?? "");
    const s = await setSticker(sticker.id, { meaning: words });
    if (s) onChange(s);
  };
  return (
    <li className={`res__row stk__row${sticker.blocked || sticker.pending ? " is-off" : ""}`}>
      {url ? (
        <img className="stk__thumb" src={url} alt={sticker.meaning ?? ""} />
      ) : (
        <span className="stk__thumb stk__thumb--none">{sticker.hint ?? <Icons.Image size={18} />}</span>
      )}
      <div className="res__main">
        <Input
          size="sm"
          aria-label={t("stk.meaning")}
          placeholder={t("stk.unnamed")}
          value={meaning}
          onChange={(e) => setMeaning(e.currentTarget.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <div className="res__desc stk__meta">
          {sticker.adult && <Badge tone="danger">{t("stk.adult")}</Badge>}
          {sticker.pending && <Badge tone="warning">{t("stk.waits")}</Badge>}
          {t("stk.counts", { seen: sticker.seen, sent: sticker.sent })}
        </div>
      </div>
      <Switch
        size="sm"
        checked={!sticker.blocked && !sticker.pending}
        label={t("stk.usable")}
        onCheckedChange={async (on) => {
          const s = await setSticker(sticker.id, { blocked: !on });
          if (s) onChange(s);
        }}
      />
      <IconButton
        size="sm"
        variant="ghost"
        label={t("stk.forget")}
        icon={<Icons.Trash2 size={14} />}
        onClick={async () => {
          if (await removeSticker(sticker.id)) onRemove();
        }}
      />
    </li>
  );
}
