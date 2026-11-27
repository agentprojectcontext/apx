import { useState } from "react";
import { Text, View } from "react-native";
import { t as translate } from "../i18n";
import type { Message } from "../protocol";
import { ActionBranch } from "./chat/ActionBranch";
import { isComputerGroup } from "./chat/blocks";
import { CompactRow } from "./chat/CompactRow";
import { ComputerIcon } from "./chat/ComputerIcon";
import { stepLabel, type ToolKind, toolKind } from "./chat/toolKind";
import { useActionDensity } from "./chat/useActionDensity";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./kit";
import { makeStyles, useTheme } from "./theme";

const ICON: Record<ToolKind, IconName> = {
  web: "Globe",
  read: "FileText",
  write: "SquarePen",
  memory: "Brain",
  command: "Terminal",
  computer: "Monitor",
  message: "MessageCircle",
  mail: "Mail",
  calendar: "Calendar",
  agents: "Users",
  task: "ListChecks",
  widget: "LayoutGrid",
  image: "Image",
  file: "Paperclip",
  phone: "Smartphone",
  ask: "Hand",
  flow: "ListChecks",
  settings: "Settings",
  skill: "Sparkles",
  tool: "Wrench",
};
type ToolPart = Extract<Message["parts"][number], { type: "tool" }>;

/** Native version of the desktop's collapsible tool action group. */
export function ActionGroup({
  parts,
  waiting = false,
  ended = false,
}: {
  parts: ToolPart[];
  waiting?: boolean;
  ended?: boolean;
}) {
  const theme = useTheme();
  const s = useStyles();
  const compact = useActionDensity();
  const [detail, setDetail] = useState<string>();
  const running = !ended && parts.some((part) => part.status === "running");
  const failed = parts.filter((part) => part.status === "error").length;
  const one = parts.length === 1;
  const computer = isComputerGroup(parts);
  const key =
    computer && !(running && waiting)
      ? running
        ? "toolsComputerWorking"
        : "toolsComputerDone"
      : running
        ? waiting
          ? one
            ? "actionsWaitingOne"
            : "actionsWaiting"
          : one
            ? "actionsWorkingOne"
            : "actionsWorking"
        : one
          ? "actionsOne"
          : "actionsSummary";
  const title = translate(key, { n: String(parts.length) });
  const status = (part: ToolPart) =>
    part.status === "error"
      ? "runFailed"
      : part.status === "ok"
        ? "runDone"
        : ended
          ? "actionStopped"
          : waiting
            ? "runWaiting"
            : "runWorking";
  const indicator = (part: ToolPart) =>
    part.status === "error" ? (
      <Icon name="CircleX" size={14} color={theme.danger} />
    ) : part.status !== "running" ? null : ended ? (
      <Icon name="Square" size={12} color={theme.fgMuted} />
    ) : waiting ? (
      <Icon name="Hand" size={14} color={theme.fgMuted} />
    ) : (
      <Spinner size={12} />
    );
  return (
    <CompactRow
      title={title}
      label={failed ? `${title} ${translate("actionsFailed", { n: failed })}` : title}
      compact
      branch={false}
      leading={
        computer ? (
          <ComputerIcon busy={running && !waiting} done={!running} size={14} />
        ) : running ? (
          waiting ? (
            <Icon name="Hand" size={14} color={theme.fgMuted} />
          ) : (
            <Spinner size={14} />
          )
        ) : undefined
      }
      trailing={
        failed > 0 ? <Text style={s.failed}>{translate("actionsFailed", { n: String(failed) })}</Text> : undefined
      }
    >
      <View style={s.rows}>
        {parts.map((part, index) => (
          <ActionBranch key={part.call_id} last={index === parts.length - 1} compact={compact || !part.detail?.trim()}>
            <CompactRow
              title={stepLabel(part.tool, part.title)}
              label={`${stepLabel(part.tool, part.title)}, ${translate(status(part))}`}
              icon={ICON[toolKind(part.tool)]}
              compact
              nested={compact}
              expanded={detail === part.call_id}
              onExpandedChange={(open) => setDetail(open ? part.call_id : undefined)}
              trailing={indicator(part)}
            >
              {part.detail?.trim() ? (
                <Text selectable style={s.detail}>
                  {part.detail}
                </Text>
              ) : undefined}
            </CompactRow>
          </ActionBranch>
        ))}
      </View>
    </CompactRow>
  );
}
const useStyles = makeStyles((theme) => ({
  failed: { color: theme.danger, fontSize: 12 },
  rows: { gap: 0, paddingRight: 4 },
  detail: { color: theme.fgMuted, fontSize: 11, lineHeight: 17, fontFamily: theme.mono },
}));
