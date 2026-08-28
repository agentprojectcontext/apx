import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bot } from "lucide-react";
import { Agents } from "../../lib/api";
import { Button, Dialog, Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { CodeProjectPicker } from "./CodeProjectPicker";
import { t } from "../../i18n";
import type { CodeMode } from "../../lib/api/code";
import type { ProjectEntry } from "../../types/daemon";

export const SUPER_AGENT_VALUE = "super-agent";

export interface NewSessionValues {
  pid: string;
  title: string;
  agentSlug: string | null;
  mode: CodeMode;
}

interface Props {
  open: boolean;
  projects: ProjectEntry[];
  /** Project the picker opens on — the one in view, or the first registered. */
  defaultPid: string;
  busy?: boolean;
  onClose: () => void;
  onCreate: (values: NewSessionValues) => void;
}

// Where a code session is configured: which project it works in, and who
// answers in it.
//
// The agent used to be a bare dropdown pinned under the session list, which
// silently re-pointed whichever session happened to be open — so it read as a
// global "who am I talking to" setting while behaving as a per-session one, and
// gave no clue that it was the thing to set BEFORE starting. It belongs here,
// at the one moment the choice is a decision: creating the session.
export function NewCodeSessionDialog({
  open,
  projects,
  defaultPid,
  busy,
  onClose,
  onCreate,
}: Props) {
  const [pid, setPid] = useState(defaultPid);
  const [title, setTitle] = useState("");
  const [agentSlug, setAgentSlug] = useState(SUPER_AGENT_VALUE);
  const [mode, setMode] = useState<CodeMode>("build");

  // Reopening starts from the project in view, never from a stale pick.
  useEffect(() => {
    if (!open) return;
    setPid(defaultPid);
    setTitle("");
    setAgentSlug(SUPER_AGENT_VALUE);
    setMode("build");
  }, [open, defaultPid]);

  // Agents are per project, so the roster follows the picker above it.
  const agents = useSWR(open && pid ? ["agents", pid] : null, () => Agents.list(pid));

  // A slug picked for another project would be silently dropped by the daemon.
  useEffect(() => {
    if (!agents.data) return;
    if (agentSlug === SUPER_AGENT_VALUE) return;
    if (!agents.data.some((a) => a.slug === agentSlug)) setAgentSlug(SUPER_AGENT_VALUE);
  }, [agents.data, agentSlug]);

  const agentOptions = [
    {
      value: SUPER_AGENT_VALUE,
      label: t("modules_ui.code_super_agent"),
      icon: Bot,
      description: t("modules_ui.code_super_agent_desc"),
    },
    ...(agents.data || []).map((a) => ({
      value: a.slug,
      label: a.name || a.slug,
      icon: Bot,
      description: a.description || a.role || a.slug,
    })),
  ];

  const modeOptions = [
    { value: "build", label: t("code_module.mode_build"), description: t("code_module.mode_build_hint") },
    { value: "plan", label: t("code_module.mode_plan"), description: t("code_module.mode_plan_hint") },
  ];

  const submit = () => {
    if (!pid) return;
    onCreate({
      pid,
      title: title.trim() || t("code_module.untitled"),
      agentSlug: agentSlug === SUPER_AGENT_VALUE ? null : agentSlug,
      mode,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("code_module.new_session")}
      description={t("code_module.new_session_desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={!pid}
            data-testid="code-new-session-submit"
          >
            {t("code_module.create_session")}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="code-new-session-dialog">
        <Field label={t("code_module.field_project")} hint={t("code_module.field_project_hint")}>
          {/* allowAll=false: a session has to live somewhere. */}
          <CodeProjectPicker
            projects={projects}
            value={pid}
            onChange={setPid}
            disabled={busy}
            allowAll={false}
          />
        </Field>

        <Field label={t("code_module.field_agent")} hint={t("code_module.field_agent_hint")}>
          <UiSelect
            value={agentSlug}
            onChange={setAgentSlug}
            options={agentOptions}
            disabled={busy}
            showIcon
          />
        </Field>

        <Field label={t("code_module.field_mode")}>
          <UiSelect value={mode} onChange={(m) => setMode(m as CodeMode)} options={modeOptions} disabled={busy} />
        </Field>

        <Field label={t("code_module.field_title")} hint={t("code_module.field_title_hint")}>
          <Input
            autoFocus
            value={title}
            placeholder={t("code_module.untitled")}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
