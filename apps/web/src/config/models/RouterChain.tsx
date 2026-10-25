import type { ModelRef } from "@apx/protocol";
import { Badge, IconButton, Icons } from "@apx/ui";
import { forAgents, inCatalog, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelRefPicker } from "./ModelRefPicker.tsx";
import { RefSelect } from "./RefSelect.tsx";

const move = (list: ModelRef[], i: number, delta: number): ModelRef[] => {
  const next = [...list];
  const j = i + delta;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j] as string, next[i] as string];
  return next;
};

/** Shared chain editor: the first model is the default; later models are fallbacks. */
export function RouterChain({ chain, onChange }: { chain: ModelRef[]; onChange: (chain: ModelRef[]) => void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  return (
    <div className="router__block">
      <div className="router__blockhead">
        <span className="router__blocktitle">{t("router.chain")}</span>
        <span className="router__blockhint">{t("router.chainHint")}</span>
      </div>
      {chain.length === 0 ? (
        // With no engine on, say what fills the chain instead of only that it is empty.
        <p className="router__empty">{t(catalog.some(forAgents) ? "router.noChain" : "router.noEngine")}</p>
      ) : (
        <ol className="chain">
          {chain.map((ref, i) => (
            <li key={ref} className="chain__item">
              <span className="rule__n">#{i + 1}</span>
              {i === 0 && (
                <Badge tone="brand" dot>
                  {t("router.default")}
                </Badge>
              )}
              <RefSelect
                value={ref}
                onChange={(next) => !chain.includes(next) && onChange(chain.map((r, j) => (j === i ? next : r)))}
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
                onClick={() => onChange(move(chain, i, -1))}
              />
              <IconButton
                size="sm"
                label={t("router.moveDown")}
                icon={<Icons.ArrowDown size={14} />}
                disabled={i === chain.length - 1}
                onClick={() => onChange(move(chain, i, 1))}
              />
              <IconButton
                size="sm"
                label={t("router.removeFromChain")}
                icon={<Icons.X size={14} />}
                onClick={() => onChange(chain.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      <div>
        <ModelRefPicker
          label={t("router.addToChain")}
          placeholder={t("router.addToChain")}
          onChange={(ref) => !chain.includes(ref) && onChange([...chain, ref])}
        />
      </div>
    </div>
  );
}
