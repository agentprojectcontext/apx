import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { attempt } from "../resources/InstalledExtension.tsx";

// The catalogs the owner adds for themself: a dialog to add one (a repository, an address, a folder, or one of the
// suggested ones with one click), and the list of the added ones with what each left out and why.

export type CatalogsState = Result<"extensions.catalogs">;
type Catalog = CatalogsState["catalogs"][number];

export function AddCatalogDialog({
  suggested,
  added,
  onClose,
  onAdded,
}: {
  suggested: CatalogsState["suggested"];
  added: Catalog[];
  onClose(): void;
  onAdded(): Promise<void>;
}) {
  const t = useT();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<string>();
  const add = async (text: string) => {
    setBusy(text);
    const c = await attempt(() => client.call("extensions.catalog_add", { source: text }), t);
    setBusy(undefined);
    if (!c) return;
    notify(t("mkt.catalogAdded", { name: c.name, n: c.count, skipped: c.skipped.length }), "info");
    await onAdded();
    onClose();
  };
  const has = (s: string) => added.some((c) => c.source.includes(s));
  return (
    <Dialog
      open
      size="md"
      title={t("mkt.catalogTitle")}
      description={t("mkt.catalogLead")}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={Boolean(busy)} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!source.trim()} loading={busy === source.trim()} onClick={() => void add(source.trim())}>
            {t("mkt.add")}
          </Button>
        </>
      }
    >
      <div className="mkt-connect">
        <Field label={t("mkt.catalogSource")}>
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder={t("mkt.catalogPlaceholder")}
              value={source}
              onChange={({ currentTarget: { value } }) => setSource(value)}
              onKeyDown={(e) => e.key === "Enter" && source.trim() && void add(source.trim())}
            />
          )}
        </Field>
        <p className="extpage__callout extpage__callout--warn">
          <Icons.TriangleAlert size={16} /> {t("mkt.catalogWarn")}
        </p>
        <span className="mkt__label">{t("mkt.suggested")}</span>
        {suggested.map((s) => (
          <div key={s.source} className="mkt-brought">
            <Icons.Store size={18} />
            <span className="mkt-brought__main">
              <b>{s.name}</b>
              <span>{s.description}</span>
            </span>
            {has(s.source) ? (
              <span className="mkt-card__done">
                <Icons.Check size={14} />
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === s.source}
                disabled={Boolean(busy)}
                onClick={() => void add(s.source)}
              >
                {t("mkt.add")}
              </Button>
            )}
          </div>
        ))}
        {busy && <p className="extpage__note">{t("mkt.catalogReading")}</p>}
        <p className="extpage__note">{t("mkt.catalogApxStays")}</p>
      </div>
    </Dialog>
  );
}

/** The owner's catalogs: read again, remove, and what each left out and why. */
export function CatalogList({ catalogs, onChanged }: { catalogs: Catalog[]; onChanged(): Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState<string>();
  const [open, setOpen] = useState<string>();
  if (!catalogs.length) return null;
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    await attempt(fn, t);
    setBusy(undefined);
    await onChanged();
  };
  return (
    <section className="mkt-catalogs">
      <span className="mkt__label">{t("mkt.catalogs")}</span>
      {catalogs.map((c) => (
        <div key={c.id} className="mkt-catalog">
          <div className="mkt-brought">
            <Icons.Store size={18} />
            <span className="mkt-brought__main">
              <b>{c.name}</b>
              <span>
                {c.source}
                {c.synced_sha ? ` · ${c.synced_sha.slice(0, 7)}` : ""}
              </span>
            </span>
            {c.skipped.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? undefined : c.id)}>
                {t("mkt.leftOut", { n: c.skipped.length })}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Icons.RefreshCw size={14} />}
              loading={busy === c.id}
              onClick={() => void act(c.id, () => client.call("extensions.catalog_sync", { id: c.id }))}
            >
              {t("mkt.sync")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act(c.id, () => client.call("extensions.catalog_remove", { id: c.id }))}
            >
              {t("mkt.remove")}
            </Button>
          </div>
          {open === c.id && (
            <ul className="mkt-skipped">
              {c.skipped.map((s) => (
                <li key={s.name}>
                  <b>{s.name}</b> · {t(`mkt.reason.${s.reason}` as MessageKey)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
