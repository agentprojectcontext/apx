import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import type { NewTask, Task, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { applyPatch, type TaskPatch, type TaskValues } from "../tasks/fields";
import { TaskFields } from "../tasks/TaskFields";
import { momentOf } from "../tasks/when";
import { Button, Card, Screen, SubHeader } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

/** A task the owner writes on the phone: title, description and the same rows as a task's page. */
export function NewTaskPage({
  data,
  back,
  create,
  created,
}: {
  data: Workspace;
  back: () => void;
  create: (task: NewTask) => Promise<Task>;
  /** The new task, to show its page. */
  created: (task: Task) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<TaskValues>({
    status: data.columns[0]?.id ?? "backlog",
    kind: "task",
    priority: "normal",
  });
  const [busy, setBusy] = useState(false);
  const change = (patch: TaskPatch) => setValues((v) => applyPatch(v, patch));
  const submit = () => {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    create({
      title: name,
      description: description.trim() || undefined,
      status: values.status,
      kind: values.kind,
      priority: values.priority,
      project: values.project,
      assignee: values.assignee,
      due_at: values.due ? momentOf(values.due).toISOString() : undefined,
    })
      .then(created)
      .catch((error) => {
        setBusy(false);
        Alert.alert(t("tkNew"), error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <View style={s.page}>
      <SubHeader
        title={t("tkNew")}
        back={back}
        right={<Button label={t("tkCreate")} size="sm" busy={busy} disabled={!title.trim()} onPress={submit} />}
      />
      <Screen>
        <Card style={s.textCard}>
          <TextInput
            autoFocus
            value={title}
            onChangeText={setTitle}
            placeholder={t("tkTitleHint")}
            placeholderTextColor={theme.fgSubtle}
            accessibilityLabel={t("tkTitle")}
            maxLength={200}
            multiline
            submitBehavior="blurAndSubmit"
            style={s.title}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t("tkDescriptionHint")}
            placeholderTextColor={theme.fgSubtle}
            accessibilityLabel={t("tkDescription")}
            maxLength={10_000}
            multiline
            style={s.description}
          />
        </Card>
        <TaskFields data={data} value={values} onChange={change} />
      </Screen>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  page: { flex: 1, backgroundColor: theme.bg },
  textCard: { gap: 6, paddingVertical: 10 },
  title: { color: theme.fg, fontSize: 18, fontWeight: "600", paddingVertical: 4 },
  description: { color: theme.fg, fontSize: 14, minHeight: 60, textAlignVertical: "top", paddingVertical: 4 },
}));
