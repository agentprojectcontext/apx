import type { ErrandCategory, ErrandPlace } from "@apx/protocol";
import { Button, Field, Icons, Input, Select, Tag } from "@apx/ui";
import { useEffect, useState } from "react";
import { usePack, useT } from "../i18n/index.ts";
import { CATEGORIES, categoryKey, parsePoint } from "./places.ts";
import "./car.css";

const MAX_CATEGORIES = 4;

/** Drops what is empty, so a place with nothing left is no place (undefined). */
function tidy(place: ErrandPlace): ErrandPlace | undefined {
  const next: ErrandPlace = { categories: place.categories };
  if (place.brand?.trim()) next.brand = place.brand.trim();
  if (place.at) next.at = place.at;
  if (place.radius_m) next.radius_m = place.radius_m;
  return next.categories.length || next.brand || next.at ? next : undefined;
}

/**
 * An errand's "Where": the kinds of shop (chips, best first), an optional brand, or one fixed place pasted as a Maps
 * link or "lat, lon". Text is committed when the field is left, so the task is not saved on every key.
 */
export function ErrandPlaceField({
  value,
  onChange,
  size = "md",
}: {
  value: ErrandPlace | undefined;
  onChange: (place: ErrandPlace | undefined) => void;
  size?: "sm" | "md";
}) {
  const ready = usePack("car");
  const t = useT();
  const place: ErrandPlace = value ?? { categories: [] };
  const [brand, setBrand] = useState(place.brand ?? "");
  useEffect(() => setBrand(value?.brand ?? ""), [value?.brand]);
  const [fixing, setFixing] = useState(false);
  const [label, setLabel] = useState("");
  const [where, setWhere] = useState("");
  const [invalid, setInvalid] = useState(false);
  if (!ready) return null;
  const set = (change: Partial<ErrandPlace>) => onChange(tidy({ ...place, ...change }));
  const left = CATEGORIES.filter((c) => !place.categories.includes(c));
  const saveFixed = () => {
    const point = parsePoint(where);
    if (!point) return setInvalid(true);
    set({ at: { ...point, ...(label.trim() ? { label: label.trim() } : {}) } });
    setFixing(false);
    setLabel("");
    setWhere("");
    setInvalid(false);
  };
  return (
    <div className="errandplace">
      <div className="errandplace__cats">
        {place.categories.map((c) => (
          <Button
            key={c}
            size="sm"
            variant="secondary"
            className="errandplace__cat"
            aria-label={t("car.removeCategory", { name: t(categoryKey(c)) })}
            onClick={() => set({ categories: place.categories.filter((x) => x !== c) })}
          >
            {t(categoryKey(c))}
            <Icons.X size={12} />
          </Button>
        ))}
        {place.categories.length < MAX_CATEGORIES && (
          <Select
            size="sm"
            className="errandplace__add"
            label={t("car.addCategory")}
            placeholder={t("car.addCategory")}
            value={null}
            options={left.map((c) => ({ value: c, label: t(categoryKey(c)) }))}
            onValueChange={(v) => {
              const c = CATEGORIES.find((x) => x === v) as ErrandCategory | undefined;
              if (c) set({ categories: [...place.categories, c] });
            }}
          />
        )}
      </div>
      <Field label={t("car.brand")}>
        {(id) => (
          <Input
            id={id}
            size={size}
            maxLength={60}
            placeholder={t("car.brandPlaceholder")}
            value={brand}
            onChange={(e) => setBrand(e.currentTarget.value)}
            onBlur={() => brand.trim() !== (place.brand ?? "") && set({ brand: brand.trim() || undefined })}
          />
        )}
      </Field>
      {place.at ? (
        <div className="errandplace__fixed">
          <Tag icon={<Icons.MapPin size={11} />}>
            {place.at.label ?? `${place.at.lat.toFixed(5)}, ${place.at.lon.toFixed(5)}`}
          </Tag>
          <Button size="sm" variant="ghost" onClick={() => set({ at: undefined })}>
            {t("car.fixedRemove")}
          </Button>
        </div>
      ) : fixing ? (
        <div className="errandplace__fixform">
          <Field label={t("car.fixedLabel")}>
            {(id) => (
              <Input
                id={id}
                size={size}
                maxLength={120}
                placeholder={t("car.fixedLabelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
            )}
          </Field>
          <Field label={t("car.fixedWhere")} error={invalid ? t("car.fixedInvalid") : undefined}>
            {(id) => (
              <Input
                id={id}
                size={size}
                invalid={invalid}
                placeholder={t("car.fixedWherePlaceholder")}
                value={where}
                onChange={(e) => {
                  setWhere(e.currentTarget.value);
                  setInvalid(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveFixed();
                  }
                }}
              />
            )}
          </Field>
          <div className="errandplace__fixed">
            <Button size="sm" variant="secondary" disabled={!where.trim()} onClick={saveFixed}>
              {t("car.fixedSave")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="errandplace__fixadd"
          leadingIcon={<Icons.Plus size={14} />}
          onClick={() => setFixing(true)}
        >
          {t("car.fixedAdd")}
        </Button>
      )}
    </div>
  );
}

/** The kinds of place on an errand's row, as small chips; the fixed place's name when it has one. */
export function ErrandChips({ place }: { place: ErrandPlace | undefined }) {
  const ready = usePack("car");
  const t = useT();
  if (!ready || !place) return null;
  return (
    <>
      {place.at?.label && (
        <span className="taskrow__tag">
          <Icons.MapPin size={10} />
          {place.at.label}
        </span>
      )}
      {place.categories.slice(0, 3).map((c) => (
        <span key={c} className="taskrow__tag">
          {t(categoryKey(c))}
        </span>
      ))}
    </>
  );
}
