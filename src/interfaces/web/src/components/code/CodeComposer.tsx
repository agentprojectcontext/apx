import { Hammer, ClipboardList } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { ChatInput } from "../ui/chat-input";
import { ModelPicker } from "../chat/ModelPicker";
import type { CodeMode } from "../../lib/api/code";

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  mode: CodeMode;
  onModeChange: (m: CodeMode) => void;
  model: string;
  onModelChange: (m: string) => void;
}

// Plan/Build segmented control — small, two-state, design-token styled.
function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: CodeMode;
  onChange: (m: CodeMode) => void;
  disabled?: boolean;
}) {
  const item = (m: CodeMode, label: string, hint: string, Icon: typeof Hammer) => (
    <button
      type="button"
      disabled={disabled}
      title={hint}
      data-testid={`code-mode-${m}`}
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        mode === m
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
      {item("build", t("code_module.mode_build"), t("code_module.mode_build_hint"), Hammer)}
      {item("plan", t("code_module.mode_plan"), t("code_module.mode_plan_hint"), ClipboardList)}
    </div>
  );
}

export function CodeComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  mode,
  onModeChange,
  model,
  onModelChange,
}: Props) {
  return (
    <ChatInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      onStop={onStop}
      busy={busy}
      disabled={disabled}
      placeholder={t("code_module.placeholder")}
      minRows={1}
      maxRows={6}
      footer={
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={onModeChange} disabled={busy} />
          <ModelPicker value={model} onChange={onModelChange} disabled={busy} />
        </div>
      }
    />
  );
}
