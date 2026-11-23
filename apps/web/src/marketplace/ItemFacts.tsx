import { Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { accessLines, authText, dayText, listingIn } from "./itemText.ts";
import "../styles/install-box.css";

// The facts beside an extension's page, before and after adding it, as Claude lists them: who makes it, its version
// and date, what it may reach, how it signs in, what it needs and does not do, its cost, its links and its
// fingerprint under Details. A fact nobody gave is not shown.

const host = (u: string) => URL.parse(u)?.host ?? u;

function Fact({ title, children }: { title: MessageKey; children: ReactNode }) {
  const t = useT();
  return (
    <div className="mkt-facts__cell">
      <h4>{t(title)}</h4>
      {children}
    </div>
  );
}

const Lines = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((x) => (
      <li key={x}>{x}</li>
    ))}
  </ul>
);

/** Its listing's https links, by what they are. */
function linksOf(item: Item): Array<{ href: string; label: MessageKey }> {
  return (
    [
      ["website", "mkt.kv.website"],
      ["docs", "mkt.kv.docs"],
      ["privacy", "mkt.kv.privacy"],
      ["terms", "mkt.kv.terms"],
    ] as const
  ).flatMap(([k, label]) => {
    const href = item.listing?.links?.[k];
    return href?.startsWith("https://") ? [{ href, label }] : [];
  });
}

function LinkList({ links }: { links: Array<{ href: string; label: MessageKey }> }) {
  const t = useT();
  return (
    <ul className="mkt-links">
      {links.map((l) => (
        <li key={l.label}>
          <Tooltip content={host(l.href)}>
            <a href={l.href} target="_blank" rel="noreferrer">
              {t(l.label)} <Icons.ExternalLink size={12} />
            </a>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

export function ItemFacts({ item }: { item: Item }) {
  const t = useT();
  const lang = useLanguage();
  const copy = listingIn(item.listing, lang);
  const access = accessLines(item, t);
  const auth = authText(item, t);
  const day = dayText(item.published, lang);
  const links = linksOf(item);
  // Files nobody verified (another catalog, a file, an address): said before adding, beside what it may reach.
  const third = item.label === "third";
  const hash = item.ext?.hash ?? item.entry?.contents?.hash;
  return (
    <section className="mkt-facts" aria-label={t("mkt.info")}>
      {day && (
        <Fact title="mkt.published">
          <span>{day}</span>
        </Fact>
      )}
      {(access.length > 0 || third) && (
        <Fact title="mkt.kv.access">
          <Lines items={third ? [...access, t("box.filesThird")] : access} />
        </Fact>
      )}
      {auth && (
        <Fact title="mkt.kv.auth">
          <span>{auth}</span>
        </Fact>
      )}
      {copy && copy.requirements.length > 0 && (
        <Fact title="extx.sec.needs">
          <Lines items={copy.requirements} />
        </Fact>
      )}
      {copy && copy.limits.length > 0 && (
        <Fact title="extx.sec.limits">
          <Lines items={copy.limits} />
        </Fact>
      )}
      {copy?.pricing && (
        <Fact title="extx.sec.cost">
          <p>{copy.pricing}</p>
        </Fact>
      )}
      {copy?.privacy && (
        <Fact title="extx.sec.privacy">
          <p>{copy.privacy}</p>
        </Fact>
      )}
      {links.length > 0 && (
        <Fact title="mkt.kv.more">
          <LinkList links={links} />
        </Fact>
      )}
      {hash && (
        <details className="mkt-details">
          <summary>
            <Icons.ChevronRight size={12} aria-hidden="true" />
            {t("box.details")}
          </summary>
          <code>{t("box.fingerprint", { id: item.id, hash })}</code>
        </details>
      )}
    </section>
  );
}
