import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  baseRef,
  type CatalogEngine,
  chosenEffort,
  effortOptions,
  type ModelChoice,
  type ModelOption,
  modelOptions,
  withEffort,
} from "../chat/models";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { BottomSheet, Chip, Spinner } from "./kit";
import { makeStyles, useTheme } from "./theme";

/**
 * Picks the chat's own model: the agent's, the router, or one model the office can run now. A model with reasoning
 * levels opens them under its row, and a level picks it.
 */
export function ModelSheet({
  current,
  agentName,
  engine,
  loadCatalog,
  onPick,
  onClose,
}: {
  current?: ModelChoice;
  agentName: string;
  /** A CLI session: only that CLI's models. */
  engine?: string;
  loadCatalog: () => Promise<CatalogEngine[]>;
  onPick: (choice: ModelChoice | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [catalog, setCatalog] = useState<CatalogEngine[]>();
  const [query, setQuery] = useState("");
  // The model whose levels show: the chat's own at first, then the one tapped.
  const [open, setOpen] = useState(() => (current?.model ? baseRef(current.model) : undefined));
  const pick = (model: ModelOption, effort = "") =>
    onPick({ model: withEffort(model.ref, effort, model.defaultEffort), router: false });
  useEffect(() => {
    void loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [loadCatalog]);
  const groups = useMemo(() => modelOptions(catalog ?? [], engine, query), [catalog, engine, query]);
  return (
    <BottomSheet title={t("modelForChat")} onClose={onClose}>
      <View style={s.search}>
        <Icon name="Search" size={16} color={theme.fgSubtle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("searchModels")}
          placeholderTextColor={theme.fgSubtle}
          style={s.searchInput}
        />
      </View>
      {!query ? (
        <>
          <Option
            id={t("agentModel")}
            sub={t("agentModelSub", { name: agentName })}
            selected={!current}
            onPress={() => onPick(null)}
            sans
          />
          {engine ? null : (
            <Option
              id={t("router")}
              sub={t("routerSub")}
              selected={Boolean(current && !current.model)}
              onPress={() => onPick({ router: true })}
              sans
            />
          )}
        </>
      ) : null}
      {catalog === undefined ? (
        <View style={s.loading}>
          <Spinner size={18} />
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={group.engine}>
          <Text style={s.group}>{group.engine}</Text>
          {group.models.map((model) => {
            const levels = effortOptions(model, t);
            const on = chosenEffort(current, model);
            const expanded = levels.length > 0 && open === model.ref;
            return (
              <View key={model.ref}>
                <Option
                  id={model.ref}
                  sub={model.name}
                  selected={on !== undefined}
                  {...(levels.length ? { expanded } : {})}
                  onPress={() => (levels.length ? setOpen(expanded ? undefined : model.ref) : pick(model))}
                />
                {expanded ? (
                  <View accessibilityLabel={t("effort")} style={s.levels}>
                    {levels.map((level) => (
                      <Chip
                        key={level.value}
                        label={level.label}
                        selected={on === level.value}
                        onPress={() => pick(model, level.value)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {catalog && query && groups.length === 0 ? <Text style={s.none}>{t("noModels")}</Text> : null}
    </BottomSheet>
  );
}

function Option({
  id,
  sub,
  selected,
  expanded,
  onPress,
  sans,
}: {
  id: string;
  sub: string;
  selected: boolean;
  /** Set when the row opens the model's levels instead of picking it. */
  expanded?: boolean;
  onPress: () => void;
  sans?: boolean;
}) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole={expanded === undefined ? "radio" : "button"}
      accessibilityState={expanded === undefined ? { checked: selected } : { selected, expanded }}
      onPress={onPress}
      style={({ pressed }) => [s.option, (selected || pressed) && { backgroundColor: theme.fill }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[s.id, !sans && { fontFamily: theme.mono }]}>
          {id}
        </Text>
        <Text numberOfLines={1} style={s.sub}>
          {sub}
        </Text>
      </View>
      {selected ? <Icon name="Check" size={18} color={theme.fg} /> : null}
      {expanded !== undefined ? (
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={16} color={theme.fgSubtle} />
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  search: {
    height: 40,
    marginHorizontal: 4,
    marginBottom: 8,
    paddingLeft: 14,
    borderRadius: 20,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  option: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  id: { color: theme.fg, fontSize: 15 },
  sub: { color: theme.fgSubtle, fontSize: 12 },
  group: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
  levels: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 },
  loading: { padding: 20, alignItems: "center" },
  none: { color: theme.fgMuted, fontSize: 13, padding: 12 },
}));
