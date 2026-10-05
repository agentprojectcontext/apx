import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { Thread, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Card, EmptyState, Muted, Page, PageHeader, RoundButton } from "../ui/components";
import { EngineIcon } from "../ui/EngineIcon";
import { Icon } from "../ui/Icon";
import { theme as t } from "../ui/theme";

export function SessionsPage({
  data,
  open,
  create,
}: {
  data: Workspace;
  open: (thread: Thread) => void;
  create: (engine: string, project: string) => Promise<Thread>;
}) {
  const newSession = (engineId: string) => {
    const projects = data.projects.filter((project) => Boolean(project.path) && project.registered !== false);
    if (!projects.length) {
      Alert.alert("Nueva sesión", "No hay proyectos locales registrados.");
      return;
    }
    Alert.alert("Nueva sesión", "Elegí proyecto", [
      ...projects.slice(0, 4).map((project) => ({
        text: project.name,
        onPress: () =>
          void create(engineId, project.id)
            .then(open)
            .catch((error) => Alert.alert("No se pudo iniciar", String(error))),
      })),
      { text: "Cancelar", style: "cancel" },
    ]);
  };
  const engines = data.engines.filter((engine) => engine.id === "claude" || engine.id === "codex");
  const sessions = data.threads.filter((thread) => thread.engine && ["claude", "codex"].includes(thread.engine));
  return (
    <View style={s.root}>
      <PageHeader title="Sesiones" subtitle="Motores externos que corren en tu Mac. Seguilos y respondé desde acá." />
      <Page>
        {engines.map((engine) => {
          const rows = sessions.filter((thread) => thread.engine === engine.id);
          const native = data.sessions[engine.id] ?? [];
          return (
            <Card key={engine.id} style={s.engineCard}>
              <View style={s.engineHeader}>
                <View style={s.engineIcon}>
                  <EngineIcon engine={engine.id === "claude" ? "claude" : "codex"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.engineName}>{engine.label}</Text>
                  <Muted>
                    ● {engine.logged_in ? "Conectado" : engine.installed ? "Instalado" : "No conectado"} · Mac
                  </Muted>
                </View>
                <RoundButton icon="Plus" label="Sesión" onPress={() => newSession(engine.id)} secondary />
              </View>
              {rows.map((thread) => (
                <SessionRow key={thread.id} thread={thread} data={data} onPress={() => open(thread)} />
              ))}
              {native
                .filter((item) => !rows.some((thread) => thread.id === item.id))
                .slice(0, 2)
                .map((item) => (
                  <View key={item.id} style={s.session}>
                    <AgentAvatar name={engine.label} size={22} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Muted numberOfLines={1}>{item.cwd}</Muted>
                    </View>
                    <Muted>{time(item.updated_at)}</Muted>
                  </View>
                ))}
              {!rows.length && !native.length ? <Muted style={s.noSessions}>No hay sesiones activas.</Muted> : null}
            </Card>
          );
        })}
        {engines.length === 0 ? (
          <EmptyState title="Sin motores conectados" body="Conectá Claude Code o Codex desde tu Mac." glyph="›_" />
        ) : null}
        <Pressable style={s.connect}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="Plus" size={18} />
            <Text style={s.connectText}>Conectar motor</Text>
          </View>
        </Pressable>
        <Muted style={s.engineList}>Gemini CLI · OpenCode · cualquier agente ACP</Muted>
      </Page>
    </View>
  );
}
function SessionRow({ thread, data, onPress }: { thread: Thread; data: Workspace; onPress: () => void }) {
  const agent = data.agents.find((item) => item.id === thread.agent_ids[0]);
  return (
    <Pressable onPress={onPress} style={s.session}>
      <AgentAvatar
        name={agent?.name ?? thread.title}
        blob={agent?.blob}
        id={agent?.id ?? thread.agent_ids[0]}
        size={22}
      />
      <View style={{ flex: 1 }}>
        <Text style={s.sessionTitle} numberOfLines={1}>
          {thread.title}
        </Text>
        <Muted numberOfLines={1}>
          {data.projects.find((project) => project.id === thread.project_id)?.name ?? "APX"} · {thread.preview}
        </Muted>
      </View>
      <Muted>{time(thread.updated_at)}</Muted>
    </Pressable>
  );
}
function time(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(d);
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  engineCard: { marginTop: 10, padding: 0, overflow: "hidden" },
  engineHeader: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  engineIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.fill,
  },
  engineGlyph: { color: t.accent, fontSize: 22 },
  engineName: { color: t.fg, fontSize: 14, fontWeight: "600" },
  session: {
    minHeight: 55,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  sessionTitle: { color: t.fg, fontSize: 13 },
  noSessions: { padding: 14 },
  connect: {
    marginTop: 14,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: t.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  connectText: { color: t.muted, fontSize: 14 },
  engineList: { textAlign: "center", marginTop: 13 },
});
