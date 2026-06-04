import { Gauge, GitCompare } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { t } from "../../i18n";
import { CodeContextTab } from "./CodeContextTab";
import { CodeChangesTab } from "./CodeChangesTab";
import type { CodeChanges, CodeTurn } from "../../lib/api/code";

interface Props {
  turns: CodeTurn[];
  changes: CodeChanges | undefined;
  changesLoading: boolean;
  onRefreshChanges: () => void;
}

// Right-hand panel: Context (token metrics + breakdown) and Changes (diffs vs
// the session's git baseline), mirroring OpenCode's session side panel.
export function CodeSidePanel({ turns, changes, changesLoading, onRefreshChanges }: Props) {
  const changeCount = changes?.files.length || 0;
  return (
    <Tabs defaultValue="context" className="flex h-full flex-col gap-0" data-testid="code-side-panel">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="context" className="flex-1">
            <Gauge className="size-3.5" /> {t("code_module.tab_context")}
          </TabsTrigger>
          <TabsTrigger value="changes" className="flex-1">
            <GitCompare className="size-3.5" /> {t("code_module.tab_changes")}
            {changeCount > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {changeCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="context" className="min-h-0 flex-1 overflow-y-auto">
        <CodeContextTab turns={turns} />
      </TabsContent>
      <TabsContent value="changes" className="min-h-0 flex-1 overflow-hidden">
        <CodeChangesTab changes={changes} loading={changesLoading} onRefresh={onRefreshChanges} />
      </TabsContent>
    </Tabs>
  );
}
