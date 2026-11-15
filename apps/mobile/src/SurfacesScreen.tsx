import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { APP_CLIENT } from "./appInfo";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { ApxClient, type Surface } from "./protocol";
import { EmptyState, IconButton, IconTile, ListGroup, ListRow, Screen, Spinner, SubHeader } from "./ui/kit";
import { SurfaceWeb, turnScreen, useTurnable } from "./ui/SurfaceWeb";
import { makeStyles } from "./ui/theme";

type Summary = Omit<Surface, "html">;

/** The owner's pinned widgets and apps; one opens full screen, live from the core. */
export function SurfacesScreen({ creds, onBack }: { creds: Creds; onBack: () => void }) {
  const styles = useStyles();
  const client = useMemo(() => new ApxClient({ url: creds.url, token: creds.token, client: APP_CLIENT }), [creds]);
  const [list, setList] = useState<Summary[]>();
  const [open, setOpen] = useState<Surface>();
  useEffect(() => {
    client
      .call("surfaces.list", {})
      .then((r) => setList(r.surfaces.filter((s) => s.pinned || s.in_apps || s.app)))
      .catch(() => setList([]));
  }, [client]);

  if (open) return <SurfaceView surface={open} client={client} onBack={() => setOpen(undefined)} />;
  return (
    <View style={styles.root}>
      <SubHeader title={t("apps")} back={onBack} />
      <Screen>
        {list === undefined ? (
          <View style={styles.loading}>
            <Spinner size={20} />
          </View>
        ) : list.length ? (
          <ListGroup>
            {list.map((item) => (
              <ListRow
                key={item.id}
                label={item.title}
                sub={item.name}
                leading={<IconTile icon="LayoutGrid" tone="brand" />}
                onPress={() => void client.call("surfaces.get", { surface: item.id }).then(setOpen)}
              />
            ))}
          </ListGroup>
        ) : (
          <EmptyState title={t("apps")} body={t("noApps")} icon="LayoutGrid" />
        )}
      </Screen>
    </View>
  );
}

function SurfaceView({ surface, client, onBack }: { surface: Surface; client: ApxClient; onBack: () => void }) {
  const styles = useStyles();
  // Open on its own, a widget may turn with the phone to show larger.
  useTurnable(true);
  return (
    <View style={styles.root}>
      <SubHeader
        title={surface.title}
        back={onBack}
        right={
          <IconButton icon="RotateCcw" label={t("widgetTurn")} onPress={() => void turnScreen().catch(() => {})} />
        }
      />
      <SurfaceWeb surface={surface} client={client} />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { padding: 40, alignItems: "center" },
}));
