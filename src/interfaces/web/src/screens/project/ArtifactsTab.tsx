import { useNavigate } from "react-router-dom";
import { Section } from "../../components/Section";
import { CodeArtifactsTab } from "../../components/code/CodeArtifactsTab";
import { t } from "../../i18n";

// Project-level view of the artifacts stored under <project>/artifacts/. Reuses
// the same list/row UI as the Code screen. Run and Edit hand off to the Code
// module — the terminal there lets you pass args (e.g. a URL) and the file
// editor lets you edit — instead of running headless in place.
export function ArtifactsTab({ pid }: { pid: string }) {
  const navigate = useNavigate();

  const toCode = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ pid, ...params }).toString();
    navigate(`/m/code?${qs}`);
  };

  return (
    <Section
      title={t("project.artifacts.title")}
      description={t("project.artifacts.subtitle")}
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
