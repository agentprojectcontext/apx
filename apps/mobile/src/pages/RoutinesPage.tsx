import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { Routine, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Card, Muted, Page, PageHeader } from "../ui/components";
import { Icon } from "../ui/Icon";
import { theme as t } from "../ui/theme";

export function RoutinesPage({
  data,
  back,
  toggle,
  run,
}: {
  data: Workspace;
  back: () => void;
  toggle: (routine: Routine, enabled: boolean) => Promise<void>;
  run: (id: string) => Promise<void>;
}) {
  return (
    <View style={s.root}>
      <PageHeader
        title="Rutinas"
        subtitle={`${data.routines.filter((item) => item.enabled).length} de ${data.routines.length} activas`}
        back={back}
      />
      <Page>
        {data.routines.map((routine) => (
          <RoutineCard key={routine.id} routine={routine} data={data} toggle={toggle} run={run} />
        ))}
        {!data.routines.length ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Sin rutinas</Text>
            <Muted>Las automatizaciones del core aparecerán acá.</Muted>
          </View>
        ) : null}
      </Page>
    </View>
  );
}
function RoutineCard({
  routine,
  data,
  toggle,
  run,
}: {
  routine: Routine;
  data: Workspace;
  toggle: (routine: Routine, enabled: boolean) => Promise<void>;
  run: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const agent = data.agents.find((item) => item.id === routine.agent_id);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={s.card}>
      <View style={s.top}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{routine.name}</Text>
          <Muted>
            {agent?.name ?? routine.agent_id} · {schedule(routine)}
          </Muted>
        </View>
        <Switch
          value={routine.enabled}
          disabled={busy}
          onValueChange={(value) => void action(() => toggle(routine, value))}
          trackColor={{ true: t.brand, false: t.fill }}
          thumbColor={t.accent}
        />
      </View>
      <View style={s.flow}>
        <AgentAvatar name={agent?.name ?? routine.agent_id} blob={agent?.blob} size={18} />
        <Text style={s.flowText} numberOfLines={1}>
          {routine.pre_command ? "pre → " : ""}Agente → {routine.post_command ? "post" : routine.action || "salida"}
        </Text>
      </View>
      <View style={s.bottom}>
        <Muted style={{ flex: 1 }} numberOfLines={1}>
          {routine.next_run_at ? `Próxima ${time(routine.next_run_at)}` : routine.enabled ? "Activa" : "Pausada"}
          {routine.last_run_at ? ` · última ${time(routine.last_run_at)}` : ""}
        </Muted>
        <Pressable disabled={busy} onPress={() => void action(() => run(routine.id))} style={s.play}>
          <Icon name="Play" size={16} color={t.fg} />
        </Pressable>
      </View>
    </Card>
  );
}
function schedule(routine: Routine) {
  const value = routine.schedule;
  if (value.kind === "every") return `Cada ${value.minutes} min`;
  if (value.kind === "cron") return value.cron ?? "Programada";
  if (value.kind === "once") return value.at ?? "Una vez";
  return "Manual";
}
function time(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(d);
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  card: { marginTop: 11, padding: 13, gap: 11 },
  top: { flexDirection: "row", alignItems: "center" },
  name: { color: t.fg, fontSize: 14, fontWeight: "700", fontFamily: "monospace" },
  flow: { flexDirection: "row", alignItems: "center", gap: 8 },
  flowText: { color: t.muted, fontSize: 12, fontFamily: "monospace", flex: 1 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  bars: { flexDirection: "row", gap: 3, height: 18, alignItems: "flex-end" },
  bar: { width: 5, height: 14, borderRadius: 2 },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  playGlyph: { color: t.fg, fontSize: 12 },
  empty: { padding: 40, alignItems: "center", gap: 8 },
  emptyTitle: { color: t.fg, fontWeight: "600", fontSize: 16 },
});
