// The views of an answer card besides a list of results: choose, compare, places, booking, a confirmation and a plan.
// Choosing writes a message to the chat as the owner (AskContext); nothing here pays or books.
import type { InlineNode, Tone } from "@apx/protocol/inline-ui";
import { Badge, Button, IconButton, Icons, Tabs } from "@apx/ui";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useT } from "../i18n/index.ts";

type Of<K extends InlineNode["kind"]> = Extract<InlineNode, { kind: K }>;

/** Writes a message to this chat as the owner; absent where a card cannot answer (a preview). */
export const AskContext = createContext<((text: string) => Promise<void>) | undefined>(undefined);

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
const BADGE: Record<Tone, "brand" | "info" | "warning" | "neutral"> = {
  brand: "brand",
  success: "brand",
  info: "info",
  warning: "warning",
  neutral: "neutral",
};
const initials = (title: string) =>
  title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function ToneBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge tone={BADGE[tone]} dot={tone !== "neutral"}>
      {label}
    </Badge>
  );
}

/** A button that writes `text` to the chat, once: then it says it was sent. */
export function AskButton({
  label,
  text,
  primary = false,
  disabled = false,
}: {
  label: string;
  text: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const ask = useContext(AskContext);
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  if (!ask) return null;
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      size="sm"
      disabled={disabled || state !== "idle"}
      loading={state === "busy"}
      leadingIcon={state === "sent" ? <Icons.Check size={14} /> : undefined}
      onClick={() => {
        setState("busy");
        ask(text).then(
          () => setState("sent"),
          () => setState("idle"),
        );
      }}
    >
      {state === "sent" ? t("cards.sent") : label}
    </Button>
  );
}

export function Head({ node }: { node: Of<"head"> }) {
  return (
    <div className="apx-card-head">
      <div>
        <div className="apx-card-head__title">{node.title}</div>
        {node.subtitle && <div className="apx-card-head__sub">{node.subtitle}</div>}
      </div>
      {node.note && (
        <Badge tone="neutral" dot>
          {node.note}
        </Badge>
      )}
    </div>
  );
}

export function Rating({ value }: { value: string }) {
  return (
    <span className="apx-rating">
      <Icons.Star size={13} />
      {value}
    </span>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  const t = useT();
  return (
    <span className="apx-stepper" title={label}>
      <IconButton
        size="sm"
        label={t("cards.fewer")}
        icon={<Icons.Minus size={14} />}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      />
      <output>{value}</output>
      <IconButton
        size="sm"
        label={t("cards.more")}
        icon={<Icons.Plus size={14} />}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      />
    </span>
  );
}

export function Choice({ node }: { node: Of<"choice"> }) {
  const t = useT();
  const [picked, setPicked] = useState<string>();
  const [count, setCount] = useState(1);
  const option = node.options.find((o) => o.id === picked);
  const name = `choice-${node.options.map((o) => o.id).join("-")}`;
  return (
    <>
      <div className="apx-choices" role="radiogroup">
        {node.options.map((o) => (
          <label key={o.id} className="apx-choice">
            <input type="radio" name={name} checked={picked === o.id} onChange={() => setPicked(o.id)} />
            <span className="apx-choice__tile" aria-hidden="true">
              {o.image ? <img src={o.image} alt="" referrerPolicy="no-referrer" /> : initials(o.title)}
            </span>
            <span className="apx-choice__body">
              <span className="apx-choice__title">
                {o.title}
                {o.badge && <ToneBadge {...o.badge} />}
              </span>
              {o.description && <span className="apx-choice__sub">{o.description}</span>}
              {o.rating && <Rating value={o.rating} />}
            </span>
            {o.price && (
              <span className="apx-price">
                {o.was && <s>{o.was}</s>}
                <b>{o.price}</b>
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="apx-checkout">
        <div className="apx-checkout__sum">
          <span>{option ? (count > 1 ? `${option.title} × ${count}` : option.title) : t("cards.choose")}</span>
          {option?.price && <small>{option.price}</small>}
        </div>
        {node.quantity && <Stepper value={count} min={1} max={node.quantity} onChange={setCount} />}
        <AskButton
          primary
          disabled={!option}
          label={node.submit.label}
          text={fill(node.submit.ask ?? t("cards.askChoice"), {
            option: option?.title ?? "",
            quantity: String(count),
            price: option?.price ?? "",
          })}
        />
      </div>
    </>
  );
}

export function Compare({ node }: { node: Of<"compare"> }) {
  const t = useT();
  const [picked, setPicked] = useState(node.picked);
  const chosen = picked === undefined ? undefined : node.columns[picked];
  return (
    <>
      <div className="apx-vs-wrap">
        <table className="apx-vs">
          <thead>
            <tr>
              <th />
              {node.columns.map((c, i) => (
                <th key={c.title} data-picked={picked === i || undefined} className="apx-vs__col">
                  <button type="button" aria-pressed={picked === i} onClick={() => setPicked(i)}>
                    <b>{c.title}</b>
                    {c.subtitle && <small>{c.subtitle}</small>}
                    {c.badge && <ToneBadge {...c.badge} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one cell per column, in order
                  <td key={i} data-best={r.best.includes(i) || undefined} data-picked={picked === i || undefined}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {node.submit && chosen && (
        <div className="apx-inline__actions">
          <AskButton
            primary
            label={fill(node.submit.label, { option: chosen.title })}
            text={fill(node.submit.ask ?? t("cards.askCompare"), { option: chosen.title })}
          />
        </div>
      )}
    </>
  );
}

/** Where each point sits in the box, as percentages, with a margin so pins never touch the edge. */
function project(points: { lat: number; lng: number }[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = (lo: number, hi: number, v: number) => (hi === lo ? 50 : 14 + ((v - lo) / (hi - lo)) * 72);
  return (p: { lat: number; lng: number }) => ({ x: span(west, east, p.lng), y: 100 - span(south, north, p.lat) });
}

export function Places({ node }: { node: Of<"places"> }) {
  const t = useT();
  const [at, setAt] = useState(node.places[0]?.id);
  const place = node.places.find((p) => p.id === at) ?? node.places[0];
  const where = project(node.origin ? [...node.places, node.origin] : node.places);
  const you = node.origin && where(node.origin);
  return (
    <>
      <div className="apx-map">
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 56">
          {[14, 28, 42].map((y) => (
            <line key={`h${y}`} x1="0" x2="100" y1={y} y2={y} />
          ))}
          {[20, 40, 60, 80].map((x) => (
            <line key={`v${x}`} x1={x} x2={x} y1="0" y2="56" />
          ))}
        </svg>
        {you && (
          <span
            className="apx-pin apx-pin--you"
            style={{ left: `${you.x}%`, top: `${you.y}%` }}
            title={t("cards.you")}
          />
        )}
        {node.places.map((p, i) => {
          const pos = where(p);
          return (
            <button
              key={p.id}
              type="button"
              className="apx-pin"
              aria-pressed={p.id === place?.id}
              aria-label={p.title}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              onClick={() => setAt(p.id)}
            >
              <b>{i + 1}</b>
              <i />
            </button>
          );
        })}
        <span className="apx-map__note">{t("cards.schematic")}</span>
      </div>
      <div className="apx-places">
        {node.places.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className="apx-selrow"
            aria-pressed={p.id === place?.id}
            onClick={() => setAt(p.id)}
          >
            <span className="apx-num-dot">{i + 1}</span>
            <span className="apx-selrow__body">
              <b>{p.title}</b>
              {p.meta && <span>{p.meta}</span>}
            </span>
            <span className="apx-selrow__aside">
              {p.rating && <Rating value={p.rating} />}
              {p.status && <ToneBadge {...p.status} />}
            </span>
          </button>
        ))}
      </div>
      {place && (
        <div className="apx-inline__actions apx-inline__actions--start">
          <a
            className="apx-inline__action"
            href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icons.MapPin size={13} />
            {t("cards.directions")}
          </a>
          {place.url && (
            <a className="apx-inline__link" href={place.url} target="_blank" rel="noopener noreferrer">
              {t("cards.open")}
            </a>
          )}
        </div>
      )}
    </>
  );
}

function Slots({
  label,
  slots,
  value,
  onPick,
  days = false,
}: {
  label: string;
  slots: { label: string; sub?: string; off: boolean }[];
  value?: number;
  onPick: (i: number) => void;
  days?: boolean;
}) {
  return (
    <fieldset className="apx-slots-field">
      <legend className="apx-inline__caption">{label}</legend>
      <div className={`apx-slots${days ? " apx-slots--days" : ""}`}>
        {slots.map((s, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: slots never reorder
            key={i}
            type="button"
            disabled={s.off}
            aria-pressed={value === i}
            onClick={() => onPick(i)}
          >
            {s.label}
            {s.sub && <small>{s.sub}</small>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Booking({ node }: { node: Of<"booking"> }) {
  const t = useT();
  const [day, setDay] = useState<number>();
  const [time, setTime] = useState<number>();
  const [people, setPeople] = useState(node.people?.value ?? 1);
  const d = day === undefined ? undefined : node.days[day];
  const h = time === undefined ? undefined : node.times[time];
  const dayText = d ? [d.label, d.sub].filter(Boolean).join(" ") : "";
  const who = people === 1 ? t("cards.person") : t("cards.people", { count: people });
  return (
    <>
      <Slots days label={t("cards.day")} slots={node.days} value={day} onPick={setDay} />
      <Slots label={t("cards.time")} slots={node.times} value={time} onPick={setTime} />
      <div className="apx-checkout">
        <div className="apx-checkout__sum">
          <span>
            {d && h ? [dayText, h.label, node.people ? who : ""].filter(Boolean).join(" · ") : t("cards.chooseTime")}
          </span>
          {node.note && <small>{node.note}</small>}
        </div>
        {node.people && (
          <Stepper value={people} min={node.people.min} max={node.people.max} onChange={setPeople} label={who} />
        )}
        <AskButton
          primary
          disabled={!d || !h}
          label={node.submit.label}
          text={fill(node.submit.ask ?? t("cards.askBooking"), {
            what: node.what,
            day: dayText,
            time: h?.label ?? "",
            people: who,
          })}
        />
      </div>
    </>
  );
}

export function Status({ node }: { node: Of<"status"> }) {
  return (
    <div className="apx-status">
      <Badge tone={BADGE[node.tone]}>
        {node.tone === "success" && <Icons.Check size={12} />}
        {node.label}
      </Badge>
      {node.when && <span>{node.when}</span>}
    </div>
  );
}

export function Code({ node }: { node: Of<"code"> }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <dl className="apx-inline__fields apx-code">
      <div>
        <dt>{node.label}</dt>
        <dd>
          <code>{node.value}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigator.clipboard.writeText(node.value).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            {copied ? t("cards.copied") : t("cards.copy")}
          </Button>
        </dd>
      </div>
    </dl>
  );
}

export function Steps({ node }: { node: Of<"steps"> }) {
  return (
    <span className="apx-steps" role="img" aria-label={`${node.done} / ${node.total}`}>
      {Array.from({ length: node.total }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional dots
        <span key={i} className="apx-step" data-done={i < node.done || undefined} />
      ))}
    </span>
  );
}

export function Agenda({ node }: { node: Of<"agenda"> }) {
  const [day, setDay] = useState("0");
  const shown = node.days[Number(day)] ?? node.days[0];
  const list: ReactNode = shown && (
    <ol className="apx-agenda">
      {shown.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a day's plan never reorders
        <li key={i} className="apx-agenda__item" data-done={item.done || undefined}>
          <span className="apx-agenda__time">{item.time}</span>
          <span className="apx-agenda__dot" />
          <span className="apx-agenda__body">
            <b className="apx-agenda__title">{item.title}</b>
            {item.meta && <span className="apx-agenda__meta">{item.meta}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
  if (node.days.length < 2) return list;
  return (
    <>
      <Tabs
        variant="underline"
        value={day}
        onValueChange={setDay}
        items={node.days.map((d, i) => ({ value: String(i), label: d.label }))}
      />
      {list}
    </>
  );
}
