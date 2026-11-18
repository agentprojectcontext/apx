import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { accessLines, authText, dayText, listingIn } from "./itemText.ts";

// The facts at the foot of an extension's page, as Claude lists them: who makes it, its version and date, what it may
// reach, how it signs in, what it needs and does not do, its cost and its links. A fact nobody gave is not shown.

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

export function ItemFacts({ item }: { item: Item }) {
  const t = useT();
  const lang = useLanguage();
  const copy = listingIn(item.listing, lang);
  const publisher = item.listing?.publisher;
  const verified = publisher?.verified || item.label === "official" || item.label === "included";
  const access = accessLines(item, t);
  const auth = authText(item, t);
  const day = dayText(item.published, lang);
  const links = (
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
  const version = item.version ?? item.ext?.version;
  return (
    <section className="mkt-facts" aria-label={t("mkt.info")}>
      {item.publisher && item.label !== "own" && (
        <Fact title="mkt.kv.publisher">
          <span>{item.publisher}</span>
          {verified && (
            <span className="mkt-facts__verified">
              <Icons.ShieldCheck size={12} />
              {t(item.label === "included" ? "mkt.label.included" : "mkt.verifiedShort")}
            </span>
          )}
        </Fact>
      )}
      {(version || day) && (
        <Fact title="extx.kv.version">
          <span>{[version, day].filter(Boolean).join(" · ")}</span>
          {item.update && <span className="mkt-facts__sub">{t("mkt.updateAvailable", { version: item.update })}</span>}
        </Fact>
      )}
      {access.length > 0 && (
        <Fact title="mkt.kv.access">
          <Lines items={access} />
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
          <ul>
            {links.map((l) => (
              <li key={l.label}>
                <a href={l.href} target="_blank" rel="noreferrer" title={host(l.href)}>
                  {t(l.label)} <Icons.ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </Fact>
      )}
    </section>
  );
}
