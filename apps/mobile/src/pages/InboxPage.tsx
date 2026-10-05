import { StyleSheet, Text, View } from "react-native";
import type { Notice, Thread, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Badge, Card, EmptyState, Muted, Page, PageHeader, RoundButton } from "../ui/components";
import { theme as t } from "../ui/theme";

export function InboxPage({
  data,
  open,
  read,
  respond,
}: {
  data: Workspace;
  open: (thread: Thread) => void;
  read: (notice: Notice) => void;
  respond: (input: string, response: { decision?: "approve" | "deny" }) => Promise<void>;
}) {
  const notices = data.notices.filter(
    (notice) =>
      notice.kind === "input" ||
      notice.kind === "task" ||
      notice.kind === "due" ||
      notice.kind === "channel" ||
      notice.kind === "agent",
  );
  return (
    <View style={s.root}>
      <PageHeader title="Bandeja" subtitle={`${data.unread} cosas esperan tu respuesta`} />
      <Page>
        {notices.length ? (
          notices.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} data={data} open={open} read={read} respond={respond} />
          ))
        ) : (
          <EmptyState title="Bandeja al día" body="Cuando algo necesite tu atención, aparecerá acá." />
        )}
      </Page>
    </View>
  );
}
function NoticeCard({
  notice,
  data,
  open,
  read,
  respond,
}: {
  notice: Notice;
  data: Workspace;
  open: (thread: Thread) => void;
  read: (notice: Notice) => void;
  respond: (input: string, response: { decision?: "approve" | "deny" }) => Promise<void>;
}) {
  const input = data.inputs.find((item) => item.id === notice.ref || item.thread_id === notice.thread_id);
  const thread = data.threads.find((item) => item.id === notice.thread_id);
  const agent = thread && data.agents.find((item) => item.id === thread.agent_ids[0]);
  const title =
    notice.kind === "input"
      ? "Aprobación"
      : notice.kind === "task"
        ? "Tarea"
        : notice.kind === "due"
          ? "Vencimiento"
          : notice.kind === "channel"
            ? "Canal"
            : "Aviso";
  const tone =
    notice.level === "error"
      ? "danger"
      : notice.level === "warning"
        ? "warning"
        : notice.kind === "input"
          ? "violet"
          : "neutral";
  return (
    <Card style={s.card}>
      <View style={s.meta}>
        <Badge tone={tone}>{title}</Badge>
        <Muted numberOfLines={1}>{thread?.project_id ?? thread?.title ?? "APX"}</Muted>
        <Muted style={{ marginLeft: "auto" }}>{time(notice.created_at)}</Muted>
      </View>
      <View style={s.message}>
        <AgentAvatar name={agent?.name ?? "APX"} blob={agent?.blob} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{notice.title}</Text>
          {notice.body ? <Muted>{notice.body}</Muted> : null}
        </View>
      </View>
      {input?.kind === "confirm" ? (
        <View style={s.actions}>
          <RoundButton label="Aprobar" onPress={() => void respond(input.id, { decision: "approve" })} />
          <RoundButton
            label="Ver"
            secondary
            onPress={() => {
              read(notice);
              if (thread) open(thread);
            }}
          />
        </View>
      ) : input ? (
        <View style={s.actions}>
          <RoundButton
            label="Responder"
            onPress={() => {
              read(notice);
              if (thread) open(thread);
            }}
          />
          <RoundButton
            label="Ver tarea"
            secondary
            onPress={() => {
              read(notice);
              if (thread) open(thread);
            }}
          />
        </View>
      ) : (
        <View style={s.actions}>
          <RoundButton
            label="Ver"
            secondary
            onPress={() => {
              read(notice);
              if (thread) open(thread);
            }}
          />
        </View>
      )}
    </Card>
  );
}
function time(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(d);
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  card: { marginTop: 10, gap: 11, padding: 13 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  message: { flexDirection: "row", gap: 10, alignItems: "center" },
  title: { color: t.fg, fontSize: 14, fontWeight: "500", marginBottom: 2 },
  actions: { flexDirection: "row", gap: 8, paddingTop: 1 },
});
