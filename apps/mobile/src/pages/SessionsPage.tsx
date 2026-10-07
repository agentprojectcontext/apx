import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { listWhen } from "../format";
import { engineName, isWorking } from "../hooks/chatSelectors";
import type { Engine, NativeSession, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { EngineIcon } from "../ui/EngineIcon";
import { Icon } from "../ui/Icon";
import { BottomSheet, Button, Dot, EmptyState, ListRow, PageTitle, Screen, Spinner, type } from "../ui/kit";
import { theme } from "../ui/theme";

type EngineId = "claude" | "codex";
const ENGINES: EngineId[] = ["claude", "codex"];
/** The last folder of a path: enough to tell sessions apart without showing the whole machine path. */
const folderOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function SessionsPage({
  data,
  open,
  create,
  resume,
}: {
  data: Workspace;
  open: (thread: Thread) => void;
  create: (engine: string, project: string) => Promise<Thread>;
  resume: (engine: string, id: string) => Promise<Thread>;
}) {
  const [picking, setPicking] = useState<EngineId>();
  const engines = data.engines.filter((engine): engine is Engine & { id: EngineId } =>
    ENGINES.includes(engine.id as EngineId),
  );
  const local = data.projects.filter((project) => project.path && project.registered !== false);
  const fail = (error: unknown) =>
    Alert.alert(t("couldNotStart"), error instanceof Error ? error.message : String(error));
  return (
    <Screen gap={14}>
      <PageTitle title={t("navSessions")} subtitle={t("sessionsLead")} />
      {engines.map((engine) => (
        <EngineCard
          key={engine.id}
          engine={engine}
          data={data}
          open={open}
          create={() => setPicking(engine.id)}
          resume={(id) => void resume(engine.id, id).then(open).catch(fail)}
        />
      ))}
      {engines.length === 0 ? (
        <EmptyState title={t("engineMissing")} body={t("connectEngineHow")} icon="Terminal" />
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => Alert.alert(t("connectEngine"), t("connectEngineHow"))}
        style={({ pressed }) => [s.connect, pressed && { backgroundColor: theme.fill }]}
      >
        <Icon name="Plus" size={16} color={theme.fgMuted} />
        <Text style={s.connectText}>{t("connectEngine")}</Text>
      </Pressable>
      <Text style={[type.meta, { textAlign: "center" }]}>{t("otherEngines")}</Text>
      {picking ? (
        <BottomSheet title={t("newSessionIn", { engine: engineName(picking) })} onClose={() => setPicking(undefined)}>
          {local.length ? (
            local.map((project) => (
              <ListRow
                key={project.id}
                label={project.name}
                sub={project.path ? folderOf(project.path) : undefined}
                leading={<Icon name="Folder" size={18} color={theme.fgMuted} />}
                onPress={() => {
                  const engine = picking;
                  setPicking(undefined);
                  void create(engine, project.id).then(open).catch(fail);
                }}
              />
            ))
          ) : (
            <Text style={[type.muted, { padding: 12 }]}>{t("noLocalProjects")}</Text>
          )}
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

function EngineCard({
  engine,
  data,
  open,
  create,
  resume,
}: {
  engine: Engine & { id: EngineId };
  data: Workspace;
  open: (thread: Thread) => void;
  create: () => void;
  resume: (id: string) => void;
}) {
  const threads = data.threads
    .filter((thread) => thread.engine === engine.id && !thread.archived)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  // Sessions started outside APX (sessions.native already leaves out the ones APX resumed).
  const native = (data.sessions[engine.id] ?? []).slice(0, 3);
  const status = engine.logged_in ? "engineConnected" : engine.installed ? "engineSignedOut" : "engineMissing";
  return (
    <View style={s.card}>
      <View style={s.head}>
        <EngineIcon engine={engine.id} size={36} shape="tile" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name}>{engineName(engine.id)}</Text>
          <View style={s.status}>
            <Dot color={engine.logged_in ? theme.brand : engine.installed ? theme.warning : theme.fgSubtle} />
            <Text numberOfLines={1} style={type.meta}>
              {t(status)}
            </Text>
          </View>
        </View>
        <Button
          label={t("newSession")}
          icon="Plus"
          size="sm"
          variant="secondary"
          onPress={create}
          disabled={!engine.installed}
        />
      </View>
      {threads.map((thread) => (
        <SessionRow key={thread.id} thread={thread} data={data} onPress={() => open(thread)} />
      ))}
      {native.map((item) => (
        <NativeRow key={item.id} session={item} onPress={() => resume(item.id)} />
      ))}
      {!threads.length && !native.length ? <Text style={[type.meta, s.none]}>{t("noSessions")}</Text> : null}
    </View>
  );
}

function SessionRow({ thread, data, onPress }: { thread: Thread; data: Workspace; onPress: () => void }) {
  const failed = thread.state === "failed";
  const project = data.projects.find((item) => item.id === thread.project_id)?.name;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      <View style={s.mark}>
        {isWorking(thread.state) ? (
          <Spinner size={14} color={theme.brand} />
        ) : (
          <Icon name={failed ? "TriangleAlert" : "Check"} size={16} color={failed ? theme.danger : theme.fgSubtle} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={s.title}>
          {thread.title}
        </Text>
        <Text numberOfLines={1} style={[s.sub, failed && { color: theme.danger }]}>
          {[project, thread.preview].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Text style={type.meta}>{listWhen(thread.updated_at)}</Text>
    </Pressable>
  );
}

function NativeRow({ session, onPress }: { session: NativeSession; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t("resume")}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      <View style={s.mark}>
        <Icon name="History" size={16} color={theme.fgSubtle} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={s.title}>
          {session.title}
        </Text>
        <Text numberOfLines={1} style={s.sub}>
          {folderOf(session.cwd)}
        </Text>
      </View>
      <Text style={type.meta}>{listWhen(session.updated_at)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  name: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  mark: { width: 20, alignItems: "center" },
  title: { color: theme.fg, fontSize: 14 },
  sub: { color: theme.fgSubtle, fontSize: 12, fontFamily: theme.mono },
  none: { paddingHorizontal: 14, paddingBottom: 14 },
  connect: {
    height: 52,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  connectText: { color: theme.fgMuted, fontSize: 14 },
});
