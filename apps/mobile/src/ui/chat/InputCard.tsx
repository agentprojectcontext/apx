import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { type Key, t } from "../../i18n";
import type { Answer, Message } from "../../protocol";
import { BrowserHelp, BrowserReview } from "../BrowserReview";
import { Icon, type IconName } from "../Icon";
import { Button, Tag } from "../kit";
import { makeStyles, useTheme } from "../theme";

type InputPart = Extract<Message["parts"][number], { type: "input" }>;
type Settled = Exclude<InputPart["state"], "pending">;
export type Respond = (input: string, answer: Answer) => Promise<void>;

/** A confirmation with no tool and no folders: the agent proposes an action and the owner accepts it or not. */
const isAction = (part: InputPart) => part.kind === "confirm" && !part.tool && !part.folders;
const DONE: Record<Settled, { label: Key; icon: IconName }> = {
  approved: { label: "inputApproved", icon: "Check" },
  answered: { label: "answered", icon: "Check" },
  denied: { label: "inputDenied", icon: "X" },
  expired: { label: "inputExpired", icon: "Clock" },
  withdrawn: { label: "withdrawn", icon: "RotateCcw" },
};
const SCOPE: Partial<Record<string, Key>> = {
  session: "inputSessionScope",
  always: "inputAgentScope",
  project: "inputProjectScope",
  tab: "browserTab",
  turn: "browserTurn",
};
/** A long patch shows its start; the rest is on the computer. */
const DIFF_LINES = 40;

/** An agent waiting for the owner: approve or decline, or answer. Once settled, one line that opens. */
export function InputCard({ part, respond }: { part: InputPart; respond: Respond }) {
  return part.state === "pending" ? (
    <PendingInput part={part} respond={respond} />
  ) : (
    <SettledInput part={part} state={part.state} />
  );
}

function SettledInput({ part, state }: { part: InputPart; state: Settled }) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const action = isAction(part);
  const what =
    part.tool === "browser_evaluate"
      ? t("browserTitle")
      : part.folders
        ? t("inputAskedFolder")
        : action
          ? t("inputAskedAction")
          : part.kind === "confirm"
            ? t("inputAsked", { tool: part.tool ?? t("inputAnAction") })
            : t("inputAskedQuestion");
  const scope = part.approval_scope ? SCOPE[part.approval_scope] : undefined;
  const outcome = [
    t(action && state === "approved" ? "inputAccepted" : DONE[state].label),
    scope ? t(scope) : "",
    part.answer && part.kind === "question" ? `“${part.answer}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={s.settled}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={s.line}
      >
        <Icon name={part.kind === "confirm" ? "Hand" : "MessageCircle"} size={14} color={theme.fgMuted} />
        <Text numberOfLines={1} style={s.lineText}>
          {what}
        </Text>
        <Icon
          name={DONE[state].icon}
          size={12}
          color={
            state === "denied"
              ? theme.danger
              : state === "approved" || state === "answered"
                ? theme.brand
                : theme.fgSubtle
          }
        />
        <Text numberOfLines={1} style={s.lineState}>
          {outcome}
        </Text>
      </Pressable>
      {open ? (
        <View style={s.settledBody}>
          <Text style={s.prompt}>{part.tool === "browser_evaluate" ? t("browserTitle") : part.prompt}</Text>
          <Detail part={part} />
          {part.answer && part.kind === "confirm" ? <Text style={s.help}>“{part.answer}”</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** What the call would do: the file's patch when the core could make one, else its arguments. */
function Detail({ part }: { part: InputPart }) {
  const theme = useTheme();
  const s = useStyles();
  const change = part.change;
  if (part.tool === "browser_evaluate" && part.browser)
    return <BrowserReview review={part.browser} source={part.detail ?? ""} />;
  if (!change)
    return part.detail ? (
      <Text selectable numberOfLines={part.tool === "browser_evaluate" ? undefined : 6} style={s.code}>
        {part.detail}
      </Text>
    ) : null;
  const lines = (change.diff ?? "").split("\n");
  return (
    <View style={s.change}>
      <View style={s.file}>
        <Icon name="FileText" size={14} color={theme.fgMuted} />
        <Text numberOfLines={1} ellipsizeMode="middle" style={s.path}>
          {change.path}
        </Text>
        {change.status === "A" ? <Tag tone="brand">{t("changesNew")}</Tag> : null}
        {change.added != null ? <Text style={[s.stat, { color: theme.brand }]}>+{change.added}</Text> : null}
        {change.removed != null ? <Text style={[s.stat, { color: theme.danger }]}>−{change.removed}</Text> : null}
      </View>
      {change.diff ? (
        <View style={s.diff}>
          {lines.slice(0, DIFF_LINES).map((line, index) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines never reorder
              key={index}
              numberOfLines={1}
              style={[
                s.diffLine,
                line.startsWith("+") && !line.startsWith("+++") && { color: theme.brand },
                line.startsWith("-") && !line.startsWith("---") && { color: theme.danger },
                line.startsWith("@@") && { color: theme.info },
              ]}
            >
              {line || " "}
            </Text>
          ))}
          {lines.length > DIFF_LINES || change.truncated ? <Text style={s.diffLine}>…</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function PendingInput({ part, respond }: { part: InputPart; respond: Respond }) {
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState<string>();
  const [reply, setReply] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const action = isAction(part);
  const scopes = part.approval_scopes;
  const many = (part.folders?.length ?? 0) > 1;
  const answer = (key: string, value: Answer) => {
    setBusy(key);
    respond(part.input_id, value)
      .catch((error) => Alert.alert(t("couldNotAnswer"), error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  const button = (key: string, label: Key, value: Answer, primary = false) => (
    <Button
      key={key}
      size="md"
      variant={primary ? "primary" : "secondary"}
      label={t(label)}
      accessibilityHint={
        part.tool === "browser_evaluate"
          ? `${t("browserScopeHelp")}${key === "tab" ? ` ${t("browserTabHelp")}` : key === "turn" ? ` ${t("browserTurnHelp")}` : ""}`
          : undefined
      }
      busy={busy === key}
      disabled={Boolean(busy)}
      onPress={() => answer(key, value)}
    />
  );
  const tick = (option: string) =>
    setPicked((current) => (current.includes(option) ? current.filter((one) => one !== option) : [...current, option]));
  return (
    <View style={s.card}>
      <View style={s.top}>
        <Tag tone={part.kind === "confirm" ? "violet" : "info"}>
          {t(action ? "inputActionTitle" : part.kind === "confirm" ? "inboxApproval" : "inboxQuestion")}
        </Tag>
        <Text style={s.state}>{t("waitsForYou")}</Text>
      </View>
      <Text style={s.prompt}>{part.tool === "browser_evaluate" ? t("browserTitle") : part.prompt}</Text>
      {part.folders?.length ? (
        <View style={s.folders}>
          {part.folders.map((folder) => (
            <Text key={folder} numberOfLines={1} ellipsizeMode="head" style={s.folder}>
              {folder}
            </Text>
          ))}
        </View>
      ) : null}
      <Detail part={part} />
      {scopes && !part.folders ? (
        part.tool === "browser_evaluate" ? (
          <BrowserHelp />
        ) : (
          <Text style={s.help}>{t("scopeHelp")}</Text>
        )
      ) : null}
      {part.kind === "confirm" ? (
        <View style={s.actions}>
          {part.folders ? (
            <>
              {button("approve", "inputFolderOnce", { decision: "approve" }, true)}
              {scopes?.includes("project")
                ? button("project", many ? "inputFolderKeepMany" : "inputFolderKeep", {
                    decision: "approve",
                    scope: "project",
                  })
                : null}
              {scopes?.includes("always")
                ? button("always", many ? "inputFolderAlwaysMany" : "inputFolderAlways", {
                    decision: "approve",
                    scope: "always",
                  })
                : null}
              {button("deny", "inputFolderDeny", { decision: "deny" })}
            </>
          ) : (
            <>
              {/* A permission (the computer) has no "only this time": it is this chat or for good. */}
              {!scopes || scopes.includes("once")
                ? button(
                    "approve",
                    action ? "inputAccept" : scopes ? "approveOnce" : "approve",
                    { decision: "approve" },
                    true,
                  )
                : null}
              {(["tab", "turn"] as const)
                .filter((scope) => scopes?.includes(scope))
                .map((scope) =>
                  button(scope, scope === "tab" ? "approveTab" : "approveTurn", { decision: "approve", scope }),
                )}
              {scopes?.includes("session")
                ? button("session", "approveSession", { decision: "approve", scope: "session" })
                : null}
              {scopes?.includes("always")
                ? button("always", "approveAlways", { decision: "approve", scope: "always" })
                : null}
              {button("deny", "deny", { decision: "deny" })}
            </>
          )}
        </View>
      ) : (
        <>
          {part.options?.length ? (
            <View style={s.actions}>
              {part.options.map((option) =>
                part.multi ? (
                  <Pressable
                    key={option}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked.includes(option) }}
                    disabled={Boolean(busy)}
                    onPress={() => tick(option)}
                    style={[s.option, picked.includes(option) && s.optionOn]}
                  >
                    {picked.includes(option) ? <Icon name="Check" size={13} color={theme.accentFg} /> : null}
                    <Text style={[s.optionText, picked.includes(option) && { color: theme.accentFg }]}>{option}</Text>
                  </Pressable>
                ) : (
                  <Button
                    key={option}
                    size="md"
                    variant="secondary"
                    label={option}
                    busy={busy === option}
                    disabled={Boolean(busy)}
                    onPress={() => answer(option, { text: option })}
                  />
                ),
              )}
            </View>
          ) : null}
          <View style={s.actions}>
            {part.multi && part.options?.length ? (
              <Button
                size="md"
                label={t("send")}
                busy={busy === "picked"}
                disabled={Boolean(busy) || !picked.length}
                onPress={() =>
                  answer("picked", { text: (part.options ?? []).filter((one) => picked.includes(one)).join(", ") })
                }
              />
            ) : null}
            <Button
              size="md"
              variant="secondary"
              label={t("inputSkip")}
              busy={busy === "skip"}
              disabled={Boolean(busy)}
              onPress={() => answer("skip", { text: t("inputSkipped") })}
            />
          </View>
          <View style={s.reply}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder={t("yourAnswer")}
              placeholderTextColor={theme.fgSubtle}
              multiline
              style={s.replyInput}
            />
            <Button
              size="md"
              label={t("send")}
              busy={busy === "text"}
              disabled={Boolean(busy) || !reply.trim()}
              onPress={() => answer("text", { text: reply.trim() })}
            />
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    padding: 14,
    gap: 10,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  state: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  prompt: { color: theme.fg, fontSize: 15, fontWeight: "500", lineHeight: 21 },
  folders: { gap: 4 },
  folder: {
    color: theme.fg,
    fontSize: 12,
    fontFamily: theme.mono,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.fill,
  },
  code: { color: theme.fgMuted, fontSize: 12, fontFamily: theme.mono },
  help: { color: theme.fgMuted, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  optionOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  optionText: { color: theme.fg, fontSize: 13 },
  reply: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  replyInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 14,
  },
  change: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, overflow: "hidden" },
  file: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  path: { flex: 1, color: theme.fg, fontSize: 12, fontFamily: theme.mono },
  stat: { fontSize: 11, fontFamily: theme.mono },
  diff: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.fill },
  diffLine: { color: theme.fgMuted, fontSize: 11, lineHeight: 16, fontFamily: theme.mono },
  settled: { alignSelf: "stretch", gap: 6 },
  line: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  lineText: { color: theme.fgMuted, fontSize: 13, flexShrink: 1 },
  lineState: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  settledBody: { gap: 8, paddingLeft: 12 },
}));
