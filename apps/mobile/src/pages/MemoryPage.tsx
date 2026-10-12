import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { listWhen } from "../format";
import type { Memory, MemoryQuery, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { BottomSheet, Button, Chip, EmptyState, Fab, Screen, Spinner, SubHeader, Tag, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

export type MemoryActions = {
  list: (params: MemoryQuery) => Promise<Memory[]>;
  add: (text: string, project?: string) => Promise<Memory>;
  remove: (id: string) => Promise<void>;
};

/** What the office remembers: everyone's notes, or one project's; searchable, and the owner adds or removes them. */
export function MemoryPage({ data, back, actions }: { data: Workspace; back: () => void; actions: MemoryActions }) {
  const theme = useTheme();
  const s = useStyles();
  const [scope, setScope] = useState<"all" | "global" | string>("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Memory[]>();
  const [refreshing, setRefreshing] = useState(false);
  const [writing, setWriting] = useState(false);
  const projects = data.projects.filter((project) => project.registered !== false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const words = query.trim() || undefined;
    const params: MemoryQuery =
      scope === "all"
        ? { query: words }
        : scope === "global"
          ? { query: words, scope: "global" }
          : { query: words, scope: "project", project: scope };
    // A search by meaning can take seconds: only the newest answer counts.
    const mine = ++request.current;
    setLoading(true);
    const found = await actions.list(params).catch(() => []);
    if (mine !== request.current) return;
    setItems(found);
    setLoading(false);
  }, [actions, scope, query]);
  useEffect(() => {
    // Typing waits a moment before asking the core.
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);
  const scopeName = (memory: Memory) =>
    memory.scope === "global"
      ? t("memGlobal")
      : memory.scope === "project"
        ? (data.projects.find((p) => p.id === memory.project_id)?.name ?? t("projects"))
        : (data.agents.find((a) => a.id === memory.agent_id)?.name ?? t("agent"));
  const author = (memory: Memory) =>
    memory.source === "owner"
      ? t("memYou")
      : (data.agents.find((a) => a.id === memory.author_agent)?.name ?? t("agent"));
  const remove = useCallback(
    (memory: Memory) =>
      Alert.alert(t("memDelete"), t("memDeleteAsk"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () =>
            void actions
              .remove(memory.id)
              .then(() => setItems((list) => list?.filter((item) => item.id !== memory.id)))
              .catch((error) => Alert.alert(t("memDelete"), String(error))),
        },
      ]),
    [actions],
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader
        title={t("memory")}
        back={back}
        right={data.memories === undefined ? undefined : t("memCount", { n: data.memories })}
      />
      <View style={s.search}>
        <Icon name="Search" size={16} color={theme.fgSubtle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("memSearch")}
          placeholderTextColor={theme.fgSubtle}
          returnKeyType="search"
          style={s.searchInput}
        />
        {loading && items !== undefined ? <Spinner size={14} /> : null}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip label={t("memAll")} selected={scope === "all"} onPress={() => setScope("all")} />
          <Chip label={t("memGlobal")} selected={scope === "global"} onPress={() => setScope("global")} />
          {projects.map((project) => (
            <Chip
              key={project.id}
              label={project.name}
              selected={scope === project.id}
              onPress={() => setScope(project.id)}
            />
          ))}
        </ScrollView>
      </View>
      <Screen
        gap={10}
        bottom={96}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.fgMuted}
            colors={[theme.fg]}
            progressBackgroundColor={theme.surfaceRaised}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {items === undefined ? (
          <View style={s.loading}>
            <Spinner size={20} />
          </View>
        ) : items.length ? (
          items.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              scope={scopeName(memory)}
              author={author(memory)}
              onRemove={remove}
            />
          ))
        ) : (
          <EmptyState title={t("memEmpty")} body={t("memEmptyBody")} icon="Brain" />
        )}
      </Screen>
      <Fab icon="Plus" label={t("memNew")} onPress={() => setWriting(true)} />
      {writing ? (
        <NewMemory
          scopeLabel={
            scope === "all" || scope === "global"
              ? t("memEveryone")
              : (projects.find((p) => p.id === scope)?.name ?? t("memEveryone"))
          }
          onClose={() => setWriting(false)}
          onSave={async (text) => {
            const memory = await actions.add(text, scope === "all" || scope === "global" ? undefined : scope);
            setItems((list) => [memory, ...(list ?? [])]);
            setWriting(false);
          }}
        />
      ) : null}
    </View>
  );
}

const MemoryCard = memo(function MemoryCard({
  memory,
  scope,
  author,
  onRemove,
}: {
  memory: Memory;
  scope: string;
  author: string;
  onRemove: (memory: Memory) => void;
}) {
  const theme = useTheme();
  const type = useType();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((value) => !value)}
      onLongPress={() => onRemove(memory)}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: theme.fill }]}
    >
      <Text selectable={open} numberOfLines={open ? undefined : 4} style={type.body}>
        {memory.text}
      </Text>
      <View style={s.meta}>
        <Tag tone={memory.scope === "global" ? "brand" : memory.scope === "project" ? "violet" : "info"}>{scope}</Tag>
        {memory.tainted ? <Tag tone="warning">{t("memOutside")}</Tag> : null}
        <Text numberOfLines={1} style={[type.meta, { flex: 1 }]}>
          {author} · {listWhen(memory.updated_at)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("memDelete")}
          hitSlop={10}
          onPress={() => onRemove(memory)}
        >
          <Icon name="Trash2" size={16} color={theme.fgSubtle} />
        </Pressable>
      </View>
    </Pressable>
  );
});

function NewMemory({
  scopeLabel,
  onClose,
  onSave,
}: {
  scopeLabel: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet title={t("memNewIn", { scope: scopeLabel })} onClose={onClose}>
      <TextInput
        autoFocus
        multiline
        value={text}
        onChangeText={setText}
        placeholder={t("memPlaceholder")}
        placeholderTextColor={theme.fgSubtle}
        maxLength={2000}
        style={s.input}
      />
      <View style={s.actions}>
        <Button label={t("cancel")} variant="secondary" onPress={onClose} />
        <Button
          label={t("memSave")}
          busy={busy}
          disabled={!text.trim()}
          onPress={() => {
            setBusy(true);
            onSave(text.trim())
              .catch((error) => Alert.alert(t("couldNotSave"), error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme) => ({
  search: {
    height: 40,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  loading: { padding: 40, alignItems: "center" },
  card: {
    padding: 14,
    gap: 10,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 110,
    maxHeight: 220,
    margin: 4,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 15,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, padding: 8 },
}));
