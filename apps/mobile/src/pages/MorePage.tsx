import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Card, Muted, Page, PageHeader } from "../ui/components";
import { Icon } from "../ui/Icon";
import { theme as t } from "../ui/theme";

const items = [
  { id: "routines", icon: "RefreshCw", title: "Rutinas", detail: "Automatizaciones", tone: t.info },
  { id: "agents", icon: "Bot", title: "Agentes", detail: "Agentes disponibles", tone: t.brand },
  { id: "projects", icon: "Folder", title: "Proyectos", detail: "Espacios de trabajo", tone: t.violet },
  { id: "channels", icon: "Send", title: "Canales", detail: "Telegram · WhatsApp", tone: t.info },
  { id: "memory", icon: "Brain", title: "Memoria", detail: "Recuerdos", tone: t.violet },
  { id: "files", icon: "FileText", title: "Archivos", detail: "Archivos recientes", tone: t.subtle },
  { id: "settings", icon: "Settings", title: "Ajustes", detail: "Preferencias", tone: t.subtle },
] as const;
/** Up to two initials of the owner's name; a generic mark when it is not set. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "·";

export function MorePage({ data, onSelect }: { data: Workspace; onSelect: (id: string) => void }) {
  return (
    <View style={s.root}>
      <PageHeader title="Más" />
      <Page>
        <Card style={s.profile}>
          <Text style={s.ownerAvatar}>{initials(data.owner)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.owner}>{data.owner || "Vos"}</Text>
            <Muted>Conectado a la Mac</Muted>
          </View>
          <Icon name="ChevronRight" size={16} />
        </Card>
        <Card style={s.menu}>
          {items.map((item, index) => (
            <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[s.row, index > 0 && s.divider]}>
              <View style={[s.icon, { backgroundColor: `${item.tone}22` }]}>
                <Icon name={item.icon} size={18} color={item.tone} />
              </View>
              <Text style={s.label}>{item.title}</Text>
              {item.id === "routines" ? (
                <Text style={s.detail}>{data.routines.filter((routine) => routine.enabled).length} activas</Text>
              ) : item.id === "agents" ? (
                <Text style={s.detail}>{data.agents.length}</Text>
              ) : item.id === "projects" ? (
                <Text style={s.detail}>{data.projects.length}</Text>
              ) : (
                <Text style={s.detail}>{item.detail}</Text>
              )}
              <Icon name="ChevronRight" size={16} />
            </Pressable>
          ))}
        </Card>
      </Page>
    </View>
  );
}
export function MoreDetailPage({ id, data, back }: { id: string; data: Workspace; back: () => void }) {
  const item = items.find((row) => row.id === id);
  const rows =
    id === "agents"
      ? data.agents.map((agent) => ({
          id: agent.id,
          title: agent.name,
          detail: agent.description ?? "Agente APX",
          blob: agent.blob,
        }))
      : id === "projects"
        ? data.projects.map((project) => ({
            id: project.id,
            title: project.name,
            detail: project.description ?? "Proyecto APX",
            blob: project.blob,
          }))
        : [];
  return (
    <View style={s.root}>
      <PageHeader title={item?.title ?? "Detalle"} back={back} />
      <Page>
        {rows.length ? (
          rows.map((row) => (
            <View key={row.id} style={s.detailRow}>
              <AgentAvatar name={row.title} blob={row.blob} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{row.title}</Text>
                <Muted>{row.detail}</Muted>
              </View>
              <Icon name="ChevronRight" size={16} />
            </View>
          ))
        ) : (
          <View style={s.placeholder}>
            <Text style={s.owner}>{item?.title ?? "Detalle"}</Text>
            <Muted>{item?.detail ?? ""} se administra desde el core APX.</Muted>
          </View>
        )}
      </Page>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  profile: { marginTop: 10, minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11 },
  owner: { color: t.fg, fontSize: 14, fontWeight: "600" },
  ownerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: t.violetSoft,
    color: t.violet,
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 13,
    fontWeight: "600",
  },
  menu: { padding: 0, overflow: "hidden", marginTop: 14 },
  row: { minHeight: 56, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: t.fg, fontSize: 14, flex: 1 },
  detail: { color: t.subtle, fontSize: 11 },
  chevron: { color: t.muted, fontSize: 22 },
  detailRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  placeholder: { padding: 22, gap: 8 },
});
