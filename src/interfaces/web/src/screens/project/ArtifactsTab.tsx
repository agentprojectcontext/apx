import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { Wrench } from "lucide-react";
import { Section } from "../../components/Section";
import { CodeArtifactsTab } from "../../components/code/CodeArtifactsTab";
import { Button } from "../../components/ui";
import { Agents } from "../../lib/api";
import { t } from "../../i18n";

// Project-level view of the artifacts stored in the project's own storage.
// Reuses the same list/row UI as the Code screen. Run and Edit hand off to the
// Code module — the terminal there lets you pass args (e.g. a URL) and the file
// editor lets you edit — instead of running headless in place.
export function ArtifactsTab({ pid }: { pid: string }) {
  const navigate = useNavigate();
  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));

  const toCode = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ pid, ...params }).toString();
    navigate(`/code?${qs}`);
  };

  // Who to ask. The orchestrator knows what the project is for; anybody else
  // would have to be told first.
  const lead = (agents.data || []).find((a) => a.is_master || a.type === "orchestrator");

  // Not "open a form": hand the agent a written request and let the person
  // edit it before sending. Same move as "Ask Roby to continue".
  const askForTool = () => {
    if (!lead) return;
    const draft = t("project.artifacts.ask_draft");
    navigate(`/p/${pid}/chat?agent=${encodeURIComponent(lead.slug)}&draft=${encodeURIComponent(draft)}`);
  };

  return (
    <Section
      title={t("project.artifacts.title")}
      description={t("project.artifacts.subtitle")}
      action={
        lead ? (
          <Button size="sm" onClick={askForTool}>
            <Wrench size={14} /> {t("project.artifacts.ask_btn", { name: lead.name || lead.slug })}
          </Button>
        ) : undefined
      }
      fullHeight
      className="min-h-[24rem]"
    >
      <CodeArtifactsTab
        pid={pid}
        onRunInTerminal={(cmd) => toCode({ cmd })}
        onEditArtifact={(name) => toCode({ edit: name })}
      />
    </Section>
  );
}
