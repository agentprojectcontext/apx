import type { ModelRef } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { inCatalog, useModels } from "../../data/models.ts";
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

/** An ordered list of models to change, move, remove and add to: the router's chain, an agent's fallbacks. */
export function ModelRefList(props: {
  refs: ModelRef[];
  onChange: (refs: ModelRef[]) => void;
  /** The add button's text; it goes away once the list holds `max`. */
  addLabel: string;
  removeLabel: string;
  /** Shown instead of the list while it is empty. */
  empty?: ReactNode;
  /** Beside a row's number (the chain's default on #1). */
  badge?: (i: number) => ReactNode;
  /** Models the list may not take (the agent's own main model). */
  taken?: ModelRef[];
  max?: number;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const { refs, onChange } = props;
  const free = (ref: ModelRef) => !refs.includes(ref) && !props.taken?.includes(ref);
  return (
    <>
      {refs.length === 0 ? (
        props.empty
      ) : (
        <ol className="chain">
          {refs.map((ref, i) => (
            <li key={ref} className="chain__item">
              <span className="rule__n">#{i + 1}</span>
              {props.badge?.(i)}
              <RefSelect
                value={ref}
                onChange={(next) => free(next) && onChange(refs.map((r, j) => (j === i ? next : r)))}
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
                onClick={() => onChange(move(refs, i, -1))}
              />
              <IconButton
                size="sm"
                label={t("router.moveDown")}
                icon={<Icons.ArrowDown size={14} />}
                disabled={i === refs.length - 1}
                onClick={() => onChange(move(refs, i, 1))}
              />
              <IconButton
                size="sm"
                label={props.removeLabel}
                icon={<Icons.X size={14} />}
                onClick={() => onChange(refs.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      {(props.max === undefined || refs.length < props.max) && (
        <div>
          <ModelRefPicker
            label={props.addLabel}
            placeholder={props.addLabel}
            onChange={(ref) => free(ref) && onChange([...refs, ref])}
          />
        </div>
      )}
    </>
  );
}
