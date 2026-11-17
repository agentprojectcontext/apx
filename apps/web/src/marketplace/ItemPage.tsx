import type { ExtensionListing } from "@apx/protocol";
import { Badge, Button, Icons, MarkdownView } from "@apx/ui";
import { Fragment, type ReactNode, useState } from "react";
import { isChannelKind } from "../channels/kinds.ts";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { ProvenanceBadge } from "../resources/ExtensionSummary.tsx";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ConnectForm, describe, IntegrationDetail } from "../resources/IncludedIntegration.tsx";
import { attempt, InstalledExtras, InstalledSide } from "../resources/InstalledExtension.tsx";
import { go } from "../shell/nav.ts";
import { Brought } from "./Brought.tsx";
import { CompanionDialog } from "./CompanionDialog.tsx";
import { ItemIcon } from "./ConnectHead.tsx";
import { ExtensionConfig } from "./ExtensionConfig.tsx";
import { KeysDialog } from "./KeysDialog.tsx";
import { useAsset } from "./useAsset.ts";

// An item's page in the Marketplace: its icon, line and publisher, screenshots, things to ask it, what it brings,
// about it, what it does, needs and does not, cost, privacy and links; beside it, the steps to have it working.

type Copy = Omit<ExtensionListing, "es">;

/** Its page copy in the language on screen (the Spanish one keeps what it does not translate). */
function useCopy(item: Item): Copy | undefined {
  const lang = useLanguage();
  const l = item.listing;
  if (!l) return undefined;
  if (lang !== "es" || !l.es) return l;
  return { ...l, ...l.es, tagline: l.es.tagline ?? l.tagline, description: l.es.description ?? l.description };
}

function Section({ title, children }: { title: MessageKey; children: ReactNode }) {
  const t = useT();
  return (
    <section className="extpage__sec">
      <h4>{t(title)}</h4>
      {children}
    </section>
  );
}

const List = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((x) => (
      <li key={x}>{x}</li>
    ))}
  </ul>
);

/** What it brings, in words: never its servers' or skills' ids (they are for the code, not the owner). */
function pieces(item: Item, t: ReturnType<typeof useT>): Array<[string, string]> {
  const e = item.ext;
  const out: Array<[string, string]> = [];
  if (item.brings.includes("accounts"))
    out.push([t("extx.piece.account"), t("extx.piece.accountText", { name: item.name })]);
  if (item.brings.includes("tools") || e?.mcp.length)
    out.push([
      t("extx.piece.tools"),
      e?.mcp.length && e.mcp.length > 1
        ? t("extx.piece.toolsMany", { name: item.name, n: e.mcp.length })
        : t("extx.piece.toolsText", { name: item.name }),
    ]);
  if (e?.skills.length || item.brings.includes("skills"))
    out.push([
      t("extx.piece.skills"),
      e?.skills.length ? t("extx.piece.skillsText", { n: e.skills.length }) : t("extx.piece.skillsSome"),
    ]);
  if (e?.companion) out.push([t("extx.brings.devices"), t("mkt.companionPiece", { app: e.companion.name })]);
  if (e?.agents.length) out.push([t("extx.brings.agents"), e.agents.map((a) => a.name).join(", ")]);
  if (e?.apps.length) out.push([t("extx.brings.apps"), String(e.apps.length)]);
  if (e?.plugin) out.push([t("extx.piece.plugin"), t("ext.runsCode")]);
  if (e?.routines.length) out.push([t("extx.piece.routines"), e.routines.map((r) => r.name).join(", ")]);
  if (e?.secrets.length) out.push([t("extx.piece.keys"), e.secrets.map((s) => s.label).join(", ")]);
  return out;
}

const STEPS: Record<Item["origin"], MessageKey[]> = {
  included: ["extx.step.connect", "extx.step.connected"],
  catalog: ["extx.step.install", "extx.step.turnOn", "extx.step.connect"],
  own: ["extx.step.install", "extx.step.turnOn", "extx.step.connect"],
};
/** Which step it is on: done ones get a check. Accounts APX ships as data connect in one step. */
function stepAt(item: Item): number {
  if (item.origin === "included" || item.integration) return item.state === "available" ? 0 : 1;
  if (item.state === "available") return 0;
  if (item.state === "off") return 1;
  if (item.state === "attention") return 2;
  return 3;
}

function Shot({ id, file, caption }: { id: string; file: string; caption: string }) {
  const url = useAsset(id, file);
  return (
    <figure className="mkt-shot">
      {url ? <img src={url} alt={caption} loading="lazy" /> : <span className="mkt-shot__empty" />}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

const host = (u: string) => URL.parse(u)?.host ?? u;

/** Where the owner's own came from, in words: the address's host, the file's name, or a folder (never its path). */
function sourceText(source: string, version: string, t: ReturnType<typeof useT>): string {
  if (source.startsWith("https://")) return t("extx.origin.own", { source: host(source), version });
  if (/^(~|\/|[A-Za-z]:[\\/])/.test(source)) return t("extx.origin.folder", { version });
  return t("extx.origin.own", { source, version });
}

export function ItemPage({ item, onBack, onChanged }: { item: Item; onBack(): void; onChanged(): Promise<void> }) {
  const t = useT();
  const copy = useCopy(item);
  const all = useData((s) => s.projects);
  const projects = all.filter((p) => p.path && p.registered !== false);
  const [connecting, setConnecting] = useState(false);
  const [keys, setKeys] = useState(false);
  const [pair, setPair] = useState(false);
  const i = item.integration;
  const tagline = copy?.tagline ?? item.tagline ?? (i ? describe(i, t) : copy?.summary || item.description);
  const about = copy?.description ?? (copy?.summary && copy.summary !== tagline ? copy.summary : undefined);
  const needs = [
    ...(copy?.requirements ?? []),
    // One signed in to through the browser needs only the account; one connected by key, what it asks for.
    ...(i
      ? i.oauth || !i.fields.length
        ? [t("extx.need.account", { name: i.label })]
        : i.fields.map((f) => f.label)
      : []),
    ...item.needs.filter((n) => n !== "code" && n !== "cost").map((n) => t(`extx.needs.${n}`)),
  ];
  const at = stepAt(item);
  const toggle = async (id: string, project: string, on: boolean) => {
    await attempt(() => client.call("mcp.toggle", { project, server: id, on }), t);
    await onChanged();
  };
  const origin =
    item.origin === "included"
      ? t("extx.origin.included")
      : item.version && item.origin === "catalog"
        ? t("extx.origin.catalog", { version: item.version })
        : item.ext
          ? sourceText(item.ext.source, item.version ?? "", t)
          : t("extx.group.catalog");
  const known = pieces(item, t);
  const hosts = item.ext?.hosts;
  const links = item.listing?.links;
  const publisher = item.listing?.publisher;
  const steps = item.origin === "included" || i ? STEPS.included : STEPS[item.origin];

  let side: ReactNode;
  if (item.builtin === "browser") side = <Button onClick={() => go.config("browser")}>{t("mkt.openSettings")}</Button>;
  else if (item.channel) {
    const kind = item.channel;
    side = (
      <>
        {item.state === "available" ? (
          <Button onClick={() => isChannelKind(kind) && go.newChannel(kind)}>{t("extx.act.connect")}</Button>
        ) : (
          <Button variant="secondary" onClick={() => go.view("channels")}>
            {t("mkt.openSettings")}
          </Button>
        )}
        <p className="extpage__note">{t("mkt.channelNote")}</p>
      </>
    );
  } else if (i) {
    if (item.state === "coming") side = <p className="extpage__note">{t("extx.coming")}</p>;
    else if (item.state === "available")
      side = (
        <>
          <Button onClick={() => setConnecting(true)}>{t("extx.act.connect")}</Button>
          {i.fields.some((f) => f.secret) && <p className="extpage__note">{t("extx.connectNote")}</p>}
        </>
      );
    else
      side = (
        <>
          {item.attention && (
            <p className="extpage__callout extpage__callout--warn">
              <Icons.TriangleAlert size={16} /> {t(`extx.fix.${item.attention}`)}
            </p>
          )}
          <IntegrationDetail i={i} projects={projects} onToggle={toggle} onChanged={onChanged} bare />
          {item.origin === "included" && <p className="extpage__note">{t("extx.includedNote")}</p>}
        </>
      );
  } else if (item.ext)
    side = (
      <>
        <InstalledSide item={{ ...item, ext: item.ext }} onChanged={onChanged} onConnect={() => setKeys(true)} />
        {item.ext.companion && (
          <Button variant="secondary" leadingIcon={<Icons.Smartphone size={14} />} onClick={() => setPair(true)}>
            {t("mkt.pair")}
          </Button>
        )}
      </>
    );
  else
    side = (
      <>
        <Button disabled={!item.url} onClick={() => item.url && openExtensionInstall({ url: item.url })}>
          {t("extx.act.install")}
        </Button>
        <p className="extpage__note">{t("extx.installNote")}</p>
      </>
    );

  return (
    <div className="extpage">
      <div className="extpage__top">
        <Button size="sm" variant="ghost" leadingIcon={<Icons.ChevronLeft size={14} />} onClick={onBack}>
          {t("extx.back")}
        </Button>
      </div>
      <header className="extpage__head">
        <ItemIcon item={item} size={56} />
        <div className="extpage__titles">
          <div className="extpage__name">
            <h2>{item.name}</h2>
            {item.provenance === "included" ? (
              <Badge tone="neutral">{t("extx.badge.included")}</Badge>
            ) : (
              <ProvenanceBadge e={{ provenance: item.provenance }} />
            )}
          </div>
          <p className="extpage__tagline">{tagline}</p>
          <span className="extpage__origin">
            {publisher ? (
              <>
                {publisher.name}
                {publisher.verified && (
                  <span className="extpage__verified" title={t("mkt.verified")}>
                    <Icons.ShieldCheck size={13} />
                  </span>
                )}
                {" · "}
              </>
            ) : null}
            {origin}
          </span>
          {item.needs.length > 0 && (
            <span className="extpage__tags">
              {item.needs.map((n) => (
                <Badge key={n} tone="neutral">
                  {t(`extx.needs.${n}`)}
                </Badge>
              ))}
            </span>
          )}
        </div>
      </header>
      <div className="extpage__grid">
        <div className="extpage__main">
          {item.listing && item.listing.screenshots.length > 0 && (
            <section className="mkt-shots" aria-label={t("mkt.screenshots")}>
              {item.listing.screenshots.map((f, n) => (
                <Shot key={f} id={item.id} file={f} caption={copy?.captions[n] ?? ""} />
              ))}
            </section>
          )}
          {copy && copy.prompts.length > 0 && (
            <section className="mkt-try">
              <h4>{t("mkt.try")}</h4>
              {copy.prompts.map((p) => (
                <span key={p} className="mkt-try__row">
                  <ItemIcon item={item} size={16} />
                  {p}
                </span>
              ))}
            </section>
          )}
          <Section title="extx.sec.brings">
            {known.length ? (
              <div className="extpage__pieces">
                {known.map(([k, v]) => (
                  <div key={k}>
                    <span className="extpage__piece">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="extpage__note">{t("extx.piece.pending")}</p>
            )}
          </Section>
          {about && (
            <Section title="mkt.about">
              <MarkdownView source={about} size="sm" />
            </Section>
          )}
          <Section title="extx.sec.does">
            <List items={copy?.features.length ? copy.features : [tagline]} />
          </Section>
          {needs.length > 0 && (
            <Section title="extx.sec.needs">
              <List items={needs} />
            </Section>
          )}
          {copy?.limits.length ? (
            <Section title="extx.sec.limits">
              <List items={copy.limits} />
            </Section>
          ) : null}
          {copy?.pricing && (
            <Section title="extx.sec.cost">
              <p>{copy.pricing}</p>
            </Section>
          )}
          {copy?.privacy && (
            <Section title="extx.sec.privacy">
              <p>{copy.privacy}</p>
            </Section>
          )}
          {item.ext && <ExtensionConfig e={item.ext} onChanged={onChanged} />}
          {item.ext && <Brought e={item.ext} />}
          {item.ext && <InstalledExtras e={item.ext} />}
        </div>
        <aside className="extpage__side">
          <div className="extpage__panel">
            <div className="extpage__steps">
              {steps.map((s, n) => (
                <span key={s} className={n < at ? "is-done" : n === at ? "is-on" : undefined}>
                  {n < at && <Icons.Check size={12} />}
                  {t(s)}
                </span>
              ))}
            </div>
            {side}
          </div>
          <dl className="extpage__kv" aria-label={t("mkt.info")}>
            <dt>{t("extx.kv.provenance")}</dt>
            <dd>
              {t(
                item.provenance === "included"
                  ? "extx.kv.included"
                  : item.provenance === "official"
                    ? "extx.kv.official"
                    : "extx.kv.third",
              )}
            </dd>
            {publisher && (
              <>
                <dt>{t("mkt.kv.publisher")}</dt>
                <dd>{publisher.name}</dd>
              </>
            )}
            {item.category && (
              <>
                <dt>{t("mkt.kv.category")}</dt>
                <dd>{t(`mkt.cat.${item.category}` as MessageKey)}</dd>
              </>
            )}
            {hosts && (
              <>
                <dt>{t("extx.kv.hosts")}</dt>
                <dd>
                  {hosts.length ? hosts.join(", ") : item.ext?.runs_code ? t("extx.kv.anyHost") : t("extx.kv.noHosts")}
                </dd>
              </>
            )}
            {item.version && (
              <>
                <dt>{t("extx.kv.version")}</dt>
                <dd>{item.version}</dd>
              </>
            )}
            {(
              [
                ["website", "mkt.kv.website"],
                ["privacy", "mkt.kv.privacy"],
                ["terms", "mkt.kv.terms"],
                ["docs", "mkt.kv.docs"],
              ] as const
            ).map(([k, label]) => {
              const href = links?.[k];
              return href?.startsWith("https://") ? (
                <Fragment key={k}>
                  <dt>{t(label)}</dt>
                  <dd>
                    <a href={href} target="_blank" rel="noreferrer">
                      {host(href)} <Icons.ExternalLink size={12} />
                    </a>
                  </dd>
                </Fragment>
              ) : null;
            })}
          </dl>
        </aside>
      </div>
      {connecting && i && (
        <ConnectForm
          i={i}
          title={t("int.connectTitle", { name: i.label })}
          onClose={() => setConnecting(false)}
          onDone={async () => {
            setConnecting(false);
            await onChanged();
          }}
        />
      )}
      {pair && item.ext?.companion && <CompanionDialog item={item} ext={item.ext} onClose={() => setPair(false)} />}
      {keys && item.ext && (
        <KeysDialog
          item={item}
          ext={item.ext}
          onClose={() => setKeys(false)}
          onDone={async () => {
            setKeys(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}
