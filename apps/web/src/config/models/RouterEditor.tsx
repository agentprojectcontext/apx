import type { ModelRef, RouterConfig, RouterRule } from "@apx/protocol";
import { Badge, Button, IconButton, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { inCatalog, refLabel, saveModelsConfig, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelRefPicker } from "./ModelPickers.tsx";
import { RefSelect } from "./RefSelect.tsx";
import { cleanWhen, RuleCard } from "./RuleCard.tsx";

const move = <T,>(list: readonly T[], i: number, delta: number): T[] => {
  const next = [...list];
  const j = i + delta;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
};

/** What the core accepts: no empty conditions, keywords of two characters or more. */
function normalize(r: RouterConfig): RouterConfig {
  return {
    chain: r.chain,
    rules: r.rules.map((rule) => {
      const keywords = rule.when.keywords?.filter((k) => k.length >= 2);
      return { ...rule, when: cleanWhen({ ...rule.when, keywords }) };
    }),
  };
}

/** Canonical JSON (sorted keys): the core may return fields in another order than the draft holds them. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x,
  );
const same = (a: RouterConfig | undefined, b: RouterConfig | undefined) =>
  canon(a && normalize(a)) === canon(b && normalize(b));

/** The draft plus a stable key per rule (rules have no id of their own). */
type Edit = { router: RouterConfig; keys: number[] };
let lastKey = 0;
const keysFor = (n: number) => Array.from({ length: n }, () => ++lastKey);
const editOf = (router: RouterConfig | undefined): Edit | undefined =>
  router && { router, keys: keysFor(router.rules.length) };

/**
 * Everyone runs on the router: its chain's #1 is the default and the rest are tried in order. An older install
 * default (a model outside the chain) shows as #1 and is folded in on save.
 */
const withDefault = (router: RouterConfig | undefined, model: ModelRef | undefined): RouterConfig | undefined =>
  router && model && !router.chain.includes(model) ? { ...router, chain: [model, ...router.chain] } : router;

/** Router: the model chain first (#1 is the default), then the content rules. Saved in one models.set_config. */
export function RouterEditor() {
  const t = useT();
  const config = useModels((s) => s.config);
  const saved = withDefault(config?.router, config?.default.model);
  const catalog = useModels((s) => s.catalog);
  const [edit, setEdit] = useState<Edit | undefined>(() => editOf(saved));
  const [base, setBase] = useState<RouterConfig | undefined>(saved);
  const [saving, setSaving] = useState(false);

  // Take the core's version when it changes and there is nothing unsaved here.
  useEffect(() => {
    if (same(saved, base)) return;
    setEdit((e) => (same(e?.router, base) ? editOf(saved) : e));
    setBase(saved);
  }, [saved, base]);

  if (!edit) return null;
  const draft = edit.router;
  const dirty = !same(draft, saved) || Boolean(config?.default.model);
  const refs = [...draft.chain, ...draft.rules.map((r) => r.model)];
  const unknown = catalog.length ? refs.filter((r) => !inCatalog(r, catalog)).length : 0;
  const setChain = (chain: ModelRef[]) => setEdit({ ...edit, router: { ...draft, chain } });
  const setRules = (rules: RouterRule[], keys: number[]) => setEdit({ router: { ...draft, rules }, keys });
  const firstRef = draft.chain[0] ?? catalog.find((e) => e.available)?.id;

  const save = async () => {
    setSaving(true);
    const next = normalize(draft);
    if (await saveModelsConfig({ router: next, default: { router: true } })) setEdit({ ...edit, router: next });
    setSaving(false);
  };

  return (
    <div className="config__section router">
      <div className="router__block">
        <div className="router__blockhead">
          <span className="router__blocktitle">{t("router.chain")}</span>
          <span className="router__blockhint">{t("router.chainHint")}</span>
        </div>
        {draft.chain.length === 0 ? (
          <p className="router__empty">{t("router.noChain")}</p>
        ) : (
          <ol className="chain">
            {draft.chain.map((ref, i) => (
              <li key={ref} className="chain__item">
                <span className="rule__n">#{i + 1}</span>
                {i === 0 && (
                  <Badge tone="brand" dot>
                    {t("router.default")}
                  </Badge>
                )}
                <RefSelect
                  value={ref}
                  onChange={(next) =>
                    !draft.chain.includes(next) && setChain(draft.chain.map((r, j) => (j === i ? next : r)))
                  }
                />
                {catalog.length > 0 && !inCatalog(ref, catalog) && (
                  <span className="chain__warn" title={t("models.notInCatalog")}>
                    <Icons.TriangleAlert size={12} />
                    {t("models.notInCatalogShort")}
                  </span>
                )}
                <IconButton
                  size="sm"
                  label={t("router.moveUp")}
                  icon={<Icons.ArrowUp size={14} />}
                  disabled={i === 0}
                  onClick={() => setChain(move(draft.chain, i, -1))}
                />
                <IconButton
                  size="sm"
                  label={t("router.moveDown")}
                  icon={<Icons.ArrowDown size={14} />}
                  disabled={i === draft.chain.length - 1}
                  onClick={() => setChain(move(draft.chain, i, 1))}
                />
                <IconButton
                  size="sm"
                  label={t("router.removeFromChain")}
                  icon={<Icons.X size={14} />}
                  onClick={() => setChain(draft.chain.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ol>
        )}
        <div>
          <ModelRefPicker
            label={t("router.addToChain")}
            placeholder={t("router.addToChain")}
            onChange={(ref) => !draft.chain.includes(ref) && setChain([...draft.chain, ref])}
          />
        </div>
      </div>

      <div className="router__block">
        <div className="router__blockhead">
          <span className="router__blocktitle">{t("router.rules")}</span>
          <span className="router__blockhint">{t("router.firstMatch")}</span>
        </div>
        {draft.rules.length === 0 ? (
          <p className="router__empty">{t("router.noRules")}</p>
        ) : (
          <ol className="router__rules">
            {draft.rules.map((rule, i) => (
              <RuleCard
                key={edit.keys[i]}
                rule={rule}
                index={i}
                count={draft.rules.length}
                onChange={(r) =>
                  setRules(
                    draft.rules.map((x, j) => (j === i ? r : x)),
                    edit.keys,
                  )
                }
                onMove={(d) => setRules(move(draft.rules, i, d), move(edit.keys, i, d))}
                onRemove={() =>
                  setRules(
                    draft.rules.filter((_, j) => j !== i),
                    edit.keys.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
          </ol>
        )}
        <div>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.Plus size={14} />}
            disabled={!firstRef}
            onClick={() =>
              firstRef && setRules([...draft.rules, { when: {}, model: firstRef }], [...edit.keys, ...keysFor(1)])
            }
          >
            {t("router.addRule")}
          </Button>
        </div>
      </div>

      <div className="router__foot">
        {unknown > 0 && (
          <span className="router__warn">
            <Icons.TriangleAlert size={14} />
            {t("router.unknownRefs", { count: unknown })}
          </span>
        )}
        <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => setEdit(editOf(saved))}>
          {t("router.revert")}
        </Button>
        <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
          {t("router.save")}
        </Button>
      </div>
    </div>
  );
}
