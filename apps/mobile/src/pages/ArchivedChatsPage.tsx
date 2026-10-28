import { ScrollView, View } from "react-native";
import { inboxTree } from "../hooks/inboxTree";
import type { Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { EmptyState, SubHeader } from "../ui/kit";
import { makeStyles } from "../ui/theme";
import { InboxRow } from "./InboxRows";

/** The chats put away: each opens as before, and a long press brings it back or deletes it. */
export function ArchivedChatsPage({
  data,
  back,
  open,
  menu,
}: {
  data: Workspace;
  back: () => void;
  open: (thread: Thread) => void;
  menu: (thread: Thread) => void;
}) {
  const s = useStyles();
  const rows = inboxTree(data.threads, { routines: true, project: "all", archived: true });
  return (
    <View style={s.root}>
      <SubHeader title={t("archivedChats")} back={back} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {rows.length ? (
          rows.map((node) => <InboxRow key={node.key} node={node} data={data} open={open} menu={menu} />)
        ) : (
          <EmptyState title={t("noArchivedChats")} body={t("noArchivedChatsBody")} icon="Archive" />
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
}));
