import { DisclosureFacts, IconButton, Icons, SummaryCard, SummaryItem, SummaryNote, SummarySection } from "@apx/ui";
import type { ReactNode } from "react";
import "@apx/ui/disclosure.css";
import "@apx/ui/summary.css";
import { useT } from "../i18n/index.ts";
import { type About, connectText, listText, originText, toolsLine } from "./about.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { fromText } from "./itemText.ts";

// The pieces that say what an extension is in the add box's card: what it brings, the facts, and the lines to read
// before deciding. Its page says the same at length (ItemBrings, ItemFacts).

const PLATFORM: Record<string, string> = {
  android: "Android",
  "android-tv": "Android TV",
  ios: "iPhone",
  macos: "Mac",
  windows: "Windows",
  linux: "Linux",
};

/** What it brings, one line each: its connection and tools, skills, agents, routines, widgets, a device's app. */
function AboutBrings({ a }: { a: About }) {
  const t = useT();
  const rows: ReactNode[] = [];
  if (a.servers > 0 || a.connection === "key" || a.connection === "oauth")
    rows.push(
      <SummaryItem key="conn" icon={<Icons.Plug size={13} />} title={t("box.connection", { name: a.name })}>
        {a.tools?.names.length
          ? t("box.tools", { n: a.tools.names.length, list: toolsLine(a.tools.names, t) })
          : t(a.label === "own" ? "box.toolsOwn" : "box.toolsLater", { name: a.name })}
      </SummaryItem>,
    );
  if (a.skillCount > 0)
    rows.push(
      <SummaryItem
        key="skills"
        icon={<Icons.Sparkles size={13} />}
        title={
          !a.skills
            ? t("box.skills")
            : a.skills.length === 1
              ? t("box.skillsOne")
              : t("box.skillsN", { n: a.skills.length })
        }
      >
        {a.skills?.length ? listText(a.skills, t) : t("box.skillsLine")}
      </SummaryItem>,
    );
  if (a.agents.length)
    rows.push(
      <SummaryItem
        key="agents"
        icon={<Icons.Bot size={13} />}
        title={a.agents.length === 1 ? t("box.agentsOne") : t("box.agentsN", { n: a.agents.length })}
      >
        {listText(a.agents, t)}
      </SummaryItem>,
    );
  if (a.routines.length)
    rows.push(
      <SummaryItem
        key="routines"
        icon={<Icons.Clock size={13} />}
        title={a.routines.length === 1 ? t("box.routinesOne") : t("box.routinesN", { n: a.routines.length })}
      >
        {t(a.routines.length === 1 ? "box.routineLine" : "box.routinesLine", { list: listText(a.routines, t) })}
      </SummaryItem>,
    );
  if (a.apps > 0)
    rows.push(
      <SummaryItem key="apps" icon={<Icons.LayoutGrid size={13} />} title={t("box.widgets")}>
        {t("box.widgetsLine")}
      </SummaryItem>,
    );
  if (a.companion)
    rows.push(
      <SummaryItem
        key="device"
        icon={<Icons.Smartphone size={13} />}
        title={t("box.deviceApp", { platform: PLATFORM[a.companion.platform] ?? a.companion.platform })}
      >
        {a.companion.name}
      </SummaryItem>,
    );
  // A catalog that only lists it (its package not read yet): Add reads it before anything is added.
  if (!rows.length) return <SummaryNote icon={<Icons.Info size={14} />}>{t("box.bringsUnknown")}</SummaryNote>;
  return <>{rows}</>;
}

/** Where it comes from, where it connects, how and what it needs. */
function AboutFacts({ a }: { a: About }) {
  const t = useT();
  const where = [
    ...a.hosts,
    ...(a.ownerHost ? [t("box.yourAddress")] : []),
    ...(!a.hosts.length && a.companion ? [t("box.yourDevice")] : []),
  ];
  return (
    <DisclosureFacts
      rows={[
        [t("box.kv.from"), a.origin ? originText(a.origin, t) : undefined],
        [t("box.kv.connects"), where.length ? where.join(", ") : undefined],
        [t("box.kv.how"), connectText(a, t)],
        [t("box.kv.needs"), a.requirements.length ? a.requirements.join(" · ") : undefined],
      ]}
    />
  );
}

/** Code that runs here, whether APX publishes these files, and its fingerprint tucked in Details. */
function AboutNotes({ a }: { a: About }) {
  const t = useT();
  const pair = Boolean(a.companion);
  return (
    <>
      {a.runsCode && (
        <SummaryNote tone="warning" icon={<Icons.Cpu size={14} />}>
          {t(pair ? "box.runsPair" : a.hosts.length ? "box.runsTo" : "box.runs", { host: a.hosts.join(", ") })}
        </SummaryNote>
      )}
      {a.files === "official" && (
        <SummaryNote tone="brand" rule icon={<Icons.BadgeCheck size={14} />}>
          {t("box.filesOfficial")}
        </SummaryNote>
      )}
      {a.files === "third" && (
        <SummaryNote tone="warning" rule icon={<Icons.TriangleAlert size={14} />}>
          {t("box.filesThird")}
        </SummaryNote>
      )}
      {a.files === "unknown" && (
        <SummaryNote rule icon={<Icons.Info size={14} />}>
          {t("box.filesUnknown")}
        </SummaryNote>
      )}
      {a.hash && (
        <details className="mkt-details">
          <summary>
            <Icons.ChevronRight size={12} aria-hidden="true" />
            {t("box.details")}
          </summary>
          <code>{t("box.fingerprint", { id: a.id, hash: a.hash })}</code>
        </details>
      )}
    </>
  );
}

/** The add box's card: who it is, then all of it, or (once added) only what it brings. */
export function AboutCard({
  a,
  compact,
  aside,
  open = true,
  onToggle,
}: {
  a: About;
  compact?: boolean;
  aside?: ReactNode;
  /** Shown whole, or only its head (while the owner pairs a device, say). */
  open?: boolean;
  onToggle?(): void;
}) {
  const t = useT();
  return (
    <SummaryCard
      icon={<ItemIcon item={a} size={36} />}
      title={a.name}
      meta={[fromText(a, t), a.version].filter(Boolean).join(" · ")}
      badge={<ItemLabel label={a.label} compact={false} />}
      description={a.tagline}
      aside={
        aside || onToggle ? (
          <span className="mkt-box__aside">
            {aside}
            {onToggle && (
              <IconButton
                size="sm"
                variant="ghost"
                label={t(open ? "box.collapse" : "box.expand")}
                aria-expanded={open}
                icon={open ? <Icons.ChevronUp size={15} /> : <Icons.ChevronDown size={15} />}
                onClick={onToggle}
              />
            )}
          </span>
        ) : undefined
      }
    >
      {!open ? null : compact ? (
        <SummarySection>
          <AboutBrings a={a} />
        </SummarySection>
      ) : (
        <>
          <SummarySection title={t("extx.sec.brings")}>
            <AboutBrings a={a} />
          </SummarySection>
          <AboutFacts a={a} />
          <AboutNotes a={a} />
        </>
      )}
    </SummaryCard>
  );
}
