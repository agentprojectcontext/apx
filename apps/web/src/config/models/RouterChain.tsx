import type { ModelRef } from "@apx/protocol";
import { Badge } from "@apx/ui";
import { forAgents, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelRefList } from "./ModelRefList.tsx";

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
      <ModelRefList
        refs={chain}
        onChange={onChange}
        addLabel={t("router.addToChain")}
        removeLabel={t("router.removeFromChain")}
        // With no engine on, say what fills the chain instead of only that it is empty.
        empty={<p className="router__empty">{t(catalog.some(forAgents) ? "router.noChain" : "router.noEngine")}</p>}
        badge={(i) =>
          i === 0 && (
            <Badge tone="brand" dot>
              {t("router.default")}
            </Badge>
          )
        }
      />
    </div>
  );
}
