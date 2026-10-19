import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import { ChatsPage } from "../pages/ChatsPage";
import { Button, useType } from "../ui/kit";
import { ThemeProvider, useSystemScheme, useTheme } from "../ui/theme";
import { inboxFixtures } from "./inboxFixtures";

export function InboxPreview({ exit }: { exit: () => void }) {
  const scheme = useSystemScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <PreviewPanel exit={exit} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function PreviewPanel({ exit }: { exit: () => void }) {
  const [data] = useState(inboxFixtures);
  const [project, setProject] = useState("all");
  const [routines, setRoutines] = useState(true);
  const [message, setMessage] = useState(t("previewReady"));
  const theme = useTheme();
  const type = useType();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ padding: 12, gap: 6 }}>
        <Text accessibilityRole="header" style={type.title}>
          {t("inboxPreview")}
        </Text>
        <Text accessibilityLiveRegion="polite" style={type.small}>
          {message}
        </Text>
        <Button label={t("previewReturn")} onPress={exit} />
      </View>
      <ChatsPage
        data={data}
        online={false}
        project={project}
        setProject={setProject}
        routines={routines}
        setRoutines={setRoutines}
        open={(thread) => setMessage(t("previewOpened", { name: `${thread.title} (${thread.id})` }))}
        create={() => setMessage(t("previewCreate"))}
        account={() => setMessage(t("previewAccount"))}
        refresh={async () => {
          setMessage(t("previewRefresh"));
        }}
      />
    </SafeAreaView>
  );
}
