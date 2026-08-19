import { useSearchParams } from "react-router-dom";
import { Sparkles, SlidersHorizontal } from "lucide-react";
import { SkillsManager } from "./SkillsManager";
import { SkillsInspectorPanel } from "./SkillsInspectorPanel";
import { t } from "../../i18n";

// One settings entry ("Skills") with two inner tabs, deep-linkable via ?tab=:
//   ?tab=manager (default) → the scope-aware skills manager
//   ?tab=rag               → the Skill Inspector (per-turn RAG) config
type Tab = "manager" | "rag";

export function SkillsSettings() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "rag" ? "rag" : "manager";

  const setTab = (v: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  // The manager fills the height it is given (list + viewer scroll inside it);
  // the RAG panel is an ordinary settings form and keeps its natural height.
  const fill = tab === "manager";
  return (
    <div className={`flex flex-col gap-5 ${fill ? "h-full" : ""}`}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border">
        <SubTab active={tab === "manager"} onClick={() => setTab("manager")}
          icon={Sparkles} label={t("skills_page.manager_tab")} />
        <SubTab active={tab === "rag"} onClick={() => setTab("rag")}
          icon={SlidersHorizontal} label={t("skills_page.rag_tab")} />
      </div>

      {fill ? (
        <div className="min-h-0 flex-1"><SkillsManager selectable /></div>
      ) : (
        <SkillsInspectorPanel />
      )}
    </div>
  );
}

function SubTab({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-fg hover:text-foreground"
      }`}>
      <Icon size={15} /> {label}
    </button>
  );
}
