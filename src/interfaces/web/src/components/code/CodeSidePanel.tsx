import { useState } from "react";
import { Gauge, GitCompare, Package } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { t } from "../../i18n";
import { CodeContextTab } from "./CodeContextTab";
import { CodeChangesTab } from "./CodeChangesTab";
import { CodeArtifactsTab } from "./CodeArtifactsTab";
import type { CodeChanges, CodeTurn } from "../../lib/api/code";

interface Props {
  pid: string;
  turns: CodeTurn[];
  changes: CodeChanges | undefined;
  changesLoading: boolean;
  onRefreshChanges: () => void;
  session?: { title: string; mode: string; createdAt: string; updatedAt: string; agentSlug: string | null } | null;
  onRunInTerminal?: (cmd: string) => void;
}

const TABS = [
  { value: "context", icon: Gauge, label: "tab_context" },
  { value: "changes", icon: GitCompare, label: "tab_changes" },
  { value: "artifacts", icon: Package, label: "tab_artifacts" },
] as const;

export function CodeSidePanel({ pid, turns, changes, changesLoading, onRefreshChanges, session, onRunInTerminal }: Props) {
  const [active, setActive] = useState<string>("context");
  const changeCount = changes?.files.length || 0;

  return (
    <Tabs value={active} onValueChange={setActive} className="flex h-full flex-col gap-0" data-testid="code-side-panel">
      <div className="shrink-0 border-b border-border px-2 py-2">
        <TabsList variant="line" className="w-full">
          {TABS.map(({ value, icon: Icon, label }) => {
            const isActive = active === value;
            const fullLabel = t(`code_module.${label}` as never);
            return (
              <TabsTrigger
                key={value}
                value={value}
                title={fullLabel}
                className={isActive ? "flex-1 min-w-0" : "w-8 shrink-0"}
              >
                <Icon className="size-3.5 shrink-0" />
                {isActive && (
                  <span className="truncate text-xs">{fullLabel}</span>
                )}
                {value === "changes" && changeCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-muted px-1 text-[10px] text-muted-foreground leading-none py-0.5">
                    {changeCount}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContent value="context" className="min-h-0 flex-1 overflow-y-auto">
        <CodeContextTab turns={turns} session={session} />
      </TabsContent>
      <TabsContent value="changes" className="min-h-0 flex-1 overflow-hidden">
        <CodeChangesTab changes={changes} loading={changesLoading} onRefresh={onRefreshChanges} />
      </TabsContent>
      <TabsContent value="artifacts" className="min-h-0 flex-1 overflow-hidden">
        <CodeArtifactsTab pid={pid} onRunInTerminal={onRunInTerminal} />
      </TabsContent>
    </Tabs>
  );
}
