import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t as translate } from "../i18n";
import type { Message } from "../protocol";
import { ActionBranch } from "./chat/ActionBranch";
import { isComputerGroup } from "./chat/blocks";
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
  const t = useTheme();
  const s = useStyles();
  const compact = useActionDensity();
  const [open, setOpen] = useState(false);
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
  const title = translate(key, {
    n: String(parts.length),
  });
  return (
    <View style={s.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={failed ? `${title} ${translate("actionsFailed", { n: failed })}` : title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={s.heading}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={t.fgMuted} />
        {computer ? (
          <ComputerIcon busy={running && !waiting} done={!running} size={16} />
        ) : running ? (
          waiting ? (
            <Icon name="Hand" size={14} color={t.fgMuted} />
          ) : (
            <Spinner size={14} />
          )
        ) : null}
        <Text style={s.title}>{title}</Text>
        {failed > 0 ? <Text style={s.failed}>{translate("actionsFailed", { n: String(failed) })}</Text> : null}
      </Pressable>
      {open ? (
        <View style={s.rows}>
          {parts.map((part, index) => {
            const Row = part.detail?.trim() ? Pressable : View;
            return (
              <ActionBranch
                key={part.call_id}
                last={index === parts.length - 1}
                compact={compact || !part.detail?.trim()}
              >
                <Row
                  accessible
                  accessibilityRole={part.detail?.trim() ? "button" : "text"}
                  accessibilityLabel={`${stepLabel(part.tool, part.title)}, ${translate(part.status === "error" ? "runFailed" : part.status === "ok" ? "runDone" : ended ? "actionStopped" : waiting ? "runWaiting" : "runWorking")}`}
                  accessibilityState={part.detail?.trim() ? { expanded: detail === part.call_id } : undefined}
                  onPress={
                    part.detail?.trim()
                      ? () => setDetail((current) => (current === part.call_id ? undefined : part.call_id))
                      : undefined
                  }
                  style={[s.row, compact && s.compactRow, !part.detail?.trim() && s.staticRow]}
                >
                  {part.detail?.trim() ? (
                    <Icon name={detail === part.call_id ? "ChevronDown" : "ChevronRight"} size={14} color={t.fgMuted} />
                  ) : null}
                  <Icon name={ICON[toolKind(part.tool)]} size={14} color={t.fgMuted} />
                  <Text
                    style={[s.summary, part.status === "error" && s.failed]}
                    numberOfLines={!part.detail?.trim() || detail === part.call_id ? undefined : 1}
                  >
                    {stepLabel(part.tool, part.title)}
                  </Text>
                  {part.status === "error" ? (
                    <Icon name="CircleX" size={14} color={t.danger} />
                  ) : part.status === "running" ? (
                    ended ? (
                      <Icon name="Square" size={12} color={t.fgMuted} />
                    ) : waiting ? (
                      <Icon name="Hand" size={14} color={t.fgMuted} />
                    ) : (
                      <Spinner size={12} />
                    )
                  ) : null}
                </Row>
                {detail === part.call_id && part.detail ? (
                  <Text selectable style={s.detail}>
                    {part.detail}
                  </Text>
                ) : null}
              </ActionBranch>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
const useStyles = makeStyles((t) => ({
  group: { alignSelf: "stretch", gap: 0 },
  heading: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  title: { color: t.fgMuted, fontSize: 13, flexShrink: 1 },
  failed: { color: t.danger, fontSize: 12 },
  rows: { gap: 0, marginLeft: 8, paddingRight: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48 },
  compactRow: { minHeight: 32, paddingVertical: 4 },
  staticRow: { minHeight: 32, paddingVertical: 4 },
  summary: { color: t.fgMuted, fontSize: 12, flex: 1 },
  detail: { color: t.fgMuted, fontSize: 11, lineHeight: 17, marginLeft: 20, paddingVertical: 6, fontFamily: t.mono },
}));
