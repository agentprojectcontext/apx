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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-border">
        <SubTab active={tab === "manager"} onClick={() => setTab("manager")}
          icon={Sparkles} label={t("skills_page.manager_tab")} />
        <SubTab active={tab === "rag"} onClick={() => setTab("rag")}
          icon={SlidersHorizontal} label={t("skills_page.rag_tab")} />
      </div>

      {tab === "manager" ? <SkillsManager selectable /> : <SkillsInspectorPanel />}
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
