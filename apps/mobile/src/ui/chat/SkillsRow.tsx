import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import type { ApxClient, Message } from "../../protocol";
import { Icon } from "../Icon";
import { BottomSheet } from "../kit";
import { makeStyles, type Theme, useTheme } from "../theme";
import { SKILL_WHY, type SkillKind, skillChips } from "./blocks";

type SkillsPart = Extract<Message["parts"][number], { type: "skills" }>;

/** The skills of this turn as small chips over the answer; each opens what it was and why it was picked. */
export function SkillsRow({
  part,
  client,
  projectId,
}: {
  part: SkillsPart;
  client: ApxClient | undefined;
  projectId: string | undefined;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState<{ name: string; kind: SkillKind }>();
  const chips = skillChips(part);
  if (!chips.length) return null;
  const title = part.engine
    ? t("skillsTitle", { engine: part.engine })
    : t("skillsAsked", { name: part.loaded[0] ?? "" });
  return (
    <View style={s.row} accessibilityLabel={title}>
      <Icon name="Sparkles" size={12} color={theme.fgSubtle} />
      {chips.map((chip) => (
        <Pressable
          key={`${chip.kind}:${chip.name}`}
          accessibilityRole="button"
          accessibilityLabel={chip.name}
          onPress={() => setOpen(chip)}
          hitSlop={4}
          style={({ pressed }) => [s.chip, chipTone(theme, chip.kind), pressed && { opacity: 0.7 }]}
        >
          <Text numberOfLines={1} style={[s.chipText, { color: chipTone(theme, chip.kind).color }]}>
            {chip.label}
          </Text>
        </Pressable>
      ))}
      {open ? (
        <BottomSheet title={open.name} onClose={() => setOpen(undefined)}>
          <SkillDetail
            name={open.name}
            kind={open.kind}
            sim={part.scored.find((one) => one.name === open.name)?.sim}
            client={client}
            projectId={projectId}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const chipTone = (theme: Theme, kind: SkillKind) =>
  kind === "loaded"
    ? { backgroundColor: theme.brandSoft, borderColor: theme.brandSoft, color: theme.brandSoftFg }
    : kind === "strong"
      ? { backgroundColor: theme.infoSoft, borderColor: theme.infoSoft, color: theme.infoSoftFg }
      : { backgroundColor: "transparent", borderColor: theme.border, color: theme.fgMuted };

/** Mounted when the sheet opens, so the skills list is read on a tap, not for every message drawn. */
function SkillDetail({
  name,
  kind,
  sim,
  client,
  projectId,
}: {
  name: string;
  kind: SkillKind;
  sim: number | undefined;
  client: ApxClient | undefined;
  projectId: string | undefined;
}) {
  const s = useStyles();
  const [description, setDescription] = useState<string | null>();
  useEffect(() => {
    if (!client) return setDescription(null);
    let live = true;
    client
      .call("skills.list", projectId ? { project: projectId } : {})
      .then((r) => live && setDescription(r.skills.find((one) => one.name === name)?.description || null))
      .catch(() => live && setDescription(null));
    return () => {
      live = false;
    };
  }, [client, name, projectId]);
  return (
    <View style={s.detail}>
      <Text style={s.why}>
        {t(SKILL_WHY[kind])}
        {sim !== undefined ? ` · ${t("skillsSim", { sim: sim.toFixed(2) })}` : ""}
      </Text>
      <Text style={s.description}>{description === undefined ? "…" : description || t("skillsNoDescription")}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingLeft: 2 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    height: 22,
    justifyContent: "center",
    maxWidth: 180,
  },
  chipText: { fontSize: 11, fontFamily: theme.mono },
  detail: { gap: 10, paddingHorizontal: 12, paddingBottom: 4 },
  why: { color: theme.fgMuted, fontSize: 13, lineHeight: 18 },
  description: { color: theme.fg, fontSize: 15, lineHeight: 21 },
}));
