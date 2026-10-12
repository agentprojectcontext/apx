import { useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { dueWhen, sentenceCase } from "../format";
import type { Routine, Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { Schedule } from "../protocol";
import { WEEK, weeklyCron, weeklyOf } from "../routines/cron";
import { EVERY_UNITS, type EveryUnit, everyMinutes, everyParts, scheduleOfKind, scheduleValid } from "../routines/edit";
import { clockValue } from "../tasks/calendar";
import { assignableAgents } from "../tasks/fields";
import { momentOf, pickerValue } from "../tasks/when";
import { DateSheet } from "../ui/DateSheet";
import { Icon } from "../ui/Icon";
import { AgentAvatar, Button, Card, Chip, ListGroup, ListRow, Screen, Segmented, SubHeader, useType } from "../ui/kit";
import { OptionSheet } from "../ui/OptionSheet";
import { makeStyles, useTheme } from "../ui/theme";

const DAY_KEYS: Key[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const UNIT_KEY: Record<EveryUnit, Key> = { minutes: "rtUnitMinutes", hours: "rtUnitHours", days: "rtUnitDays" };
const PROMPT_KEY: Record<string, Key> = { message: "rtMessage", shell: "rtNote" };

/** A routine's name, what it does, its agent, when it runs and its commands; saved whole with the header's button. */
export function RoutineEditPage({
  routine,
  data,
  back,
  save,
}: {
  routine: Routine;
  data: Workspace;
  back: () => void;
  save: (routine: Routine, patch: Partial<Routine>) => Promise<void>;
}) {
  const type = useType();
  const s = useStyles();
  const [name, setName] = useState(routine.name);
  const [prompt, setPrompt] = useState(routine.prompt);
  const [agentId, setAgentId] = useState(routine.agent_id);
  const [schedule, setSchedule] = useState<Schedule>(routine.schedule);
  const [pre, setPre] = useState(routine.pre_command ?? "");
  const [post, setPost] = useState(routine.post_command ?? "");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = data.agents.find((item) => item.id === agentId);
  const usesAgent = routine.action !== "message" && routine.action !== "shell";
  const commands = routine.action === "shell" || Boolean(routine.pre_command || routine.post_command);
  const ready = Boolean(name.trim() && prompt.trim() && scheduleValid(schedule));
  const submit = () => {
    if (!ready) return Alert.alert(t("rtEdit"), t("rtIncomplete"));
    setBusy(true);
    save(routine, {
      name: name.trim(),
      prompt: prompt.trim(),
      agent_id: agentId,
      schedule,
      pre_command: pre.trim(),
      post_command: post.trim(),
    })
      .then(back)
      .catch((error) => {
        setBusy(false);
        Alert.alert(routine.name, error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <View style={s.page}>
      <SubHeader
        title={t("rtEdit")}
        back={back}
        right={<Button label={t("save")} size="sm" busy={busy} disabled={!ready} onPress={submit} />}
      />
      <Screen>
        <Field label={t("rtName")}>
          <TextInput value={name} onChangeText={setName} maxLength={120} style={[s.input, type.mono]} />
        </Field>
        <Field label={t(PROMPT_KEY[routine.action] ?? "rtPrompt")}>
          <TextInput value={prompt} onChangeText={setPrompt} multiline maxLength={20_000} style={[s.input, s.prompt]} />
        </Field>
        {usesAgent ? (
          <ListGroup>
            <ListRow
              label={t("agent")}
              leading={agent ? <AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={28} /> : undefined}
              detail={agent?.name ?? agentId}
              onPress={() => setPicking(true)}
            />
          </ListGroup>
        ) : null}
        <Field label={t("rtWhen")}>
          <ScheduleEditor value={schedule} onChange={setSchedule} />
        </Field>
        {commands ? (
          <Field label={t("rtCommands")}>
            <Text style={type.meta}>{t("rtPreLabel")}</Text>
            <TextInput
              value={pre}
              onChangeText={setPre}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={4000}
              style={[s.input, type.mono]}
            />
            <Text style={type.meta}>{t("rtPostLabel")}</Text>
            <TextInput
              value={post}
              onChangeText={setPost}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={4000}
              style={[s.input, type.mono]}
            />
          </Field>
        ) : null}
      </Screen>
      {picking ? (
        <OptionSheet
          title={t("agent")}
          value={agentId}
          options={assignableAgents(data.agents, routine.project_id).map((item) => ({
            value: item.id,
            label: item.name,
            sub: item.kind === "secretary" ? t("superAgent") : sentenceCase(item.role),
            leading: <AgentAvatar name={item.name} blob={item.blob} id={item.id} size={28} />,
          }))}
          onPick={setAgentId}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const type = useType();
  const s = useStyles();
  return (
    <Card style={s.field}>
      <Text style={type.meta}>{label}</Text>
      {children}
    </Card>
  );
}

/** By kind: days and a time (or a cron expression), every N units, one moment, or by hand only. */
function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [advanced, setAdvanced] = useState(() => value.kind === "cron" && !weeklyOf(value.cron));
  const [dating, setDating] = useState(false);
  const weekly = value.kind === "cron" ? weeklyOf(value.cron) : undefined;
  return (
    <View style={{ gap: 12 }}>
      <Segmented
        value={value.kind}
        onChange={(kind) => {
          if (kind === value.kind) return;
          setAdvanced(false);
          onChange(scheduleOfKind(kind));
        }}
        options={[
          { value: "cron", label: t("rtKindCron") },
          { value: "every", label: t("rtKindEvery") },
          { value: "once", label: t("rtKindOnce") },
          { value: "manual", label: t("rtKindManual") },
        ]}
      />
      {value.kind === "cron" && weekly && !advanced ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {WEEK.map((day) => {
              const on = weekly.days.includes(day);
              return (
                <Chip
                  key={day}
                  label={t(DAY_KEYS[day] ?? "sun")}
                  selected={on}
                  onPress={() => {
                    const days = on ? weekly.days.filter((d) => d !== day) : [...weekly.days, day];
                    if (days.length) onChange({ kind: "cron", cron: weeklyCron(days, weekly.time) });
                  }}
                />
              );
            })}
          </ScrollView>
          <ClockInput
            value={weekly.time}
            onChange={(time) => onChange({ kind: "cron", cron: weeklyCron(weekly.days, time) })}
          />
        </>
      ) : null}
      {value.kind === "cron" && (advanced || !weekly) ? (
        <>
          <TextInput
            value={value.cron}
            onChangeText={(cron) => onChange({ kind: "cron", cron })}
            accessibilityLabel={t("rtCronLabel")}
            autoCapitalize="none"
            autoCorrect={false}
            style={[s.input, type.mono]}
          />
          <Text style={type.meta}>{t("rtCronHint")}</Text>
        </>
      ) : null}
      {value.kind === "cron" ? (
        <Button
          label={advanced || !weekly ? t("rtSimple") : t("rtAdvanced")}
          variant="secondary"
          size="sm"
          onPress={() => {
            if ((advanced || !weekly) && !weeklyOf(value.cron)) onChange(scheduleOfKind("cron"));
            setAdvanced(!(advanced || !weekly));
          }}
        />
      ) : null}
      {value.kind === "every" ? <EveryInput minutes={value.minutes} onChange={onChange} /> : null}
      {value.kind === "once" ? (
        <ListGroup>
          <ListRow
            label={t("rtOnceAt")}
            leading={<Icon name="Calendar" size={18} color={theme.fgMuted} />}
            detail={dueWhen(value.at)}
            onPress={() => setDating(true)}
          />
        </ListGroup>
      ) : null}
      {dating && value.kind === "once" ? (
        <DateSheet
          title={t("rtOnceAt")}
          time="required"
          value={pickerValue(value.at)}
          onPick={(picked) => picked && onChange({ kind: "once", at: momentOf(picked).toISOString() })}
          onClose={() => setDating(false)}
        />
      ) : null}
    </View>
  );
}

/** "HH:MM", taken once it reads as a time; what is typed meanwhile stays in the field. */
function ClockInput({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const type = useType();
  const s = useStyles();
  const [typed, setTyped] = useState(value);
  return (
    <View style={s.inline}>
      <Text style={[type.body, { flex: 1 }]}>{t("rtTime")}</Text>
      <TextInput
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          const clock = clockValue(text);
          if (clock) onChange(clock);
        }}
        onEndEditing={() => setTyped(value)}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        accessibilityLabel={t("rtTime")}
        style={[s.input, s.small]}
      />
    </View>
  );
}

function EveryInput({ minutes, onChange }: { minutes: number; onChange: (s: Schedule) => void }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const { n, unit } = everyParts(minutes);
  const [typed, setTyped] = useState(String(n));
  const set = (count: number, next: EveryUnit) => onChange({ kind: "every", minutes: everyMinutes(count, next) });
  return (
    <View style={{ gap: 10 }}>
      <View style={s.inline}>
        <TextInput
          value={typed}
          onChangeText={(text) => {
            setTyped(text);
            const count = Number.parseInt(text, 10);
            if (count > 0) set(count, unit);
          }}
          onEndEditing={() => setTyped(String(n))}
          keyboardType="number-pad"
          maxLength={5}
          accessibilityLabel={t("rtKindEvery")}
          style={[s.input, s.small]}
        />
        <View style={{ flex: 1 }}>
          <Segmented
            value={unit}
            onChange={(next) => set(n, next)}
            options={EVERY_UNITS.map((item) => ({ value: item.id, label: t(UNIT_KEY[item.id]) }))}
          />
        </View>
      </View>
      {minutes < 5 ? <Text style={[type.meta, { color: theme.danger }]}>{t("rtMinFive")}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  page: { flex: 1, backgroundColor: theme.bg },
  field: { gap: 8 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 15,
  },
  prompt: { minHeight: 120, maxHeight: 320, textAlignVertical: "top" },
  small: { width: 84, textAlign: "center" },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  chips: { gap: 6 },
}));
