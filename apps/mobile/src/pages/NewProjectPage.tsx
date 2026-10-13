import { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import type { Project } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import { Button, Card, IconTile, ListGroup, ListRow, Screen, SubHeader, useType } from "../ui/kit";
import { OptionSheet } from "../ui/OptionSheet";
import { makeStyles, useTheme } from "../ui/theme";

const KINDS = ["none", "personal", "app", "company", "software", "other"] as const;
type Kind = (typeof KINDS)[number];
const KIND_KEY: Record<Kind, Key> = {
  none: "pjKindNone",
  personal: "pjKindPersonal",
  app: "pjKindApp",
  company: "pjKindCompany",
  software: "pjKindSoftware",
  other: "pjKindOther",
};

/**
 * A project made from the phone: name, kind and description. The phone has no folders to offer, so the computer makes
 * one of its own inside APX's; a project in a chosen folder is made from the computer.
 */
export function NewProjectPage({
  host,
  back,
  create,
  created,
}: {
  host: string;
  back: () => void;
  create: (p: { name: string; kind?: string; description?: string }) => Promise<Project>;
  created: (project: Project) => void;
}) {
  const theme = useTheme();
  const type = useType();
  const s = useStyles();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Kind>("none");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    create({
      name: title,
      ...(kind !== "none" ? { kind } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    })
      .then(created)
      .catch((error) => {
        setBusy(false);
        Alert.alert(t("pjNew"), error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <View style={s.page}>
      <SubHeader
        title={t("pjNew")}
        back={back}
        right={<Button label={t("tkCreate")} size="sm" busy={busy} disabled={!name.trim()} onPress={submit} />}
      />
      <Screen>
        <Card style={s.textCard}>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder={t("pjNameHint")}
            placeholderTextColor={theme.fgSubtle}
            accessibilityLabel={t("pjName")}
            maxLength={80}
            submitBehavior="blurAndSubmit"
            style={s.title}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t("pjDescriptionHint")}
            placeholderTextColor={theme.fgSubtle}
            accessibilityLabel={t("tkDescription")}
            maxLength={500}
            multiline
            style={s.description}
          />
        </Card>
        <ListGroup>
          <ListRow
            label={t("pjKind")}
            detail={t(KIND_KEY[kind])}
            leading={<IconTile icon="Folder" tone="violet" />}
            onPress={() => setPicking(true)}
          />
        </ListGroup>
        <Text style={[type.meta, s.where]}>{t("pjWhere", { host })}</Text>
      </Screen>
      {picking ? (
        <OptionSheet
          title={t("pjKind")}
          value={kind}
          options={KINDS.map((value) => ({ value, label: t(KIND_KEY[value]) }))}
          onPick={setKind}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  page: { flex: 1, backgroundColor: theme.bg },
  textCard: { gap: 6, paddingVertical: 10 },
  title: { color: theme.fg, fontSize: 18, fontWeight: "600", paddingVertical: 4 },
  description: { color: theme.fg, fontSize: 14, minHeight: 60, textAlignVertical: "top", paddingVertical: 4 },
  where: { paddingHorizontal: 4 },
}));
