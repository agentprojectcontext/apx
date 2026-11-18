import type { Result } from "@apx/protocol";
import { Button, ConfirmDialog, Dialog, Field, IconButton, Icons, Input, Tooltip } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { attempt } from "../resources/InstalledExtension.tsx";

// The catalogs the owner adds for themself: a dialog to add one (a repository, an address, a folder, or one of the
// suggested ones with one click), and the list of the added ones.

export type CatalogsState = Result<"extensions.catalogs">;

/** The suggested catalogs' lines in the owner's language. */
const SUGGESTED_TEXT: Record<string, MessageKey> = {
  "anthropics/knowledge-work-plugins": "mkt.suggest.knowledgeWork",
  "anthropics/claude-plugins-official": "mkt.suggest.claudePlugins",
};
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
            <Icons.Puzzle size={18} />
            <span className="mkt-brought__main">
              <b>{s.name}</b>
              <span>{SUGGESTED_TEXT[s.source] ? t(SUGGESTED_TEXT[s.source] as MessageKey) : s.description}</span>
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

/** APX's catalog, which always stays, and the owner's: how many extensions each lists, read again, remove. */
export function CatalogList({
  catalogs,
  apxCount,
  onChanged,
  onOpen,
}: {
  catalogs: Catalog[];
  /** How many APX's own catalog offers. */
  apxCount: number | undefined;
  onChanged(): Promise<void>;
  /** Shows that catalog's extensions in Explore ("apx" for APX's). */
  onOpen(id: string): void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string>();
  const [removing, setRemoving] = useState<Catalog>();
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    await attempt(fn, t);
    setBusy(undefined);
    await onChanged();
  };
  return (
    <section className="mkt-catalogs">
      <div className="mkt-catalog">
        <div className="mkt-brought">
          <Icons.Puzzle size={18} />
          <span className="mkt-brought__main">
            <b>APX</b>
            <span>{apxCount === undefined ? t("mkt.catalogApx") : t("mkt.catalogApxCount", { n: apxCount })}</span>
          </span>
          <Button size="sm" variant="ghost" trailingIcon={<Icons.ArrowRight size={14} />} onClick={() => onOpen("apx")}>
            {t("mkt.catalogSee")}
          </Button>
          <Tooltip content={t("mkt.catalogFixed")}>
            <span className="mkt-catalog__always" role="img" aria-label={t("mkt.catalogFixed")}>
              <Icons.Lock size={14} />
            </span>
          </Tooltip>
        </div>
      </div>
      {catalogs.map((c) => (
        <div key={c.id} className="mkt-catalog">
          <div className="mkt-brought">
            <Icons.Puzzle size={18} />
            <span className="mkt-brought__main">
              <b>{c.name}</b>
              <span>
                {c.source} · {t("mkt.catalogCount", { n: c.count })}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={<Icons.ArrowRight size={14} />}
              onClick={() => onOpen(c.id)}
            >
              {t("mkt.catalogSee")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Icons.RefreshCw size={14} />}
              loading={busy === c.id}
              onClick={() => void act(c.id, () => client.call("extensions.catalog_sync", { id: c.id }))}
            >
              {t("mkt.sync")}
            </Button>
            <IconButton
              size="sm"
              variant="ghost"
              label={t("mkt.remove")}
              icon={<Icons.Trash2 size={14} />}
              onClick={() => setRemoving(c)}
            />
          </div>
        </div>
      ))}
      {removing && (
        <ConfirmDialog
          title={t("mkt.catalogRemoveTitle", { name: removing.name })}
          description={t("mkt.catalogRemoveBody", { n: removing.count })}
          confirmLabel={t("mkt.remove")}
          cancelLabel={t("common.cancel")}
          closeLabel={t("common.close")}
          onConfirm={() => act(removing.id, () => client.call("extensions.catalog_remove", { id: removing.id }))}
          onClose={() => setRemoving(undefined)}
        />
      )}
    </section>
  );
}
