import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type CatalogEngine, type ModelChoice, modelOptions } from "../chat/models";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { BottomSheet, Spinner } from "./kit";
import { makeStyles, useTheme } from "./theme";

/** Picks the chat's own model: the agent's, the router, or one model the office can run now. */
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
          {group.models.map((model) => (
            <Option
              key={model.ref}
              id={model.ref}
              sub={model.name}
              selected={current?.model?.replace(/#.*$/, "") === model.ref}
              onPress={() => onPick({ model: model.ref, router: false })}
            />
          ))}
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
  onPress,
  sans,
}: {
  id: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
  sans?: boolean;
}) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
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
  loading: { padding: 20, alignItems: "center" },
  none: { color: theme.fgMuted, fontSize: 13, padding: 12 },
}));
