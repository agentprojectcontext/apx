import { useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { ApxClient, ApxError, type ApxSocket, type CoreEvent, type Message } from "./protocol";

const HOME = "home";
const RETRY_MS = [1000, 2000, 5000, 10000];

/** The super-agent's chat (Home): what was said, live over the socket, and a box to write. */
export function ChatScreen({ creds, onUnpair }: { creds: Creds; onUnpair: () => void }) {
  const client = useMemo(
    () => new ApxClient({ url: creds.url, token: creds.token, client: { name: "apx-mobile", version: "0.0.0" } }),
    [creds],
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState(false);
  const [text, setText] = useState("");
  const list = useRef<FlatList<Message>>(null);

  useEffect(() => {
    let socket: ApxSocket | undefined;
    let stopped = false;
    let attempt = 0;
    const upsert = (m: Message) =>
      setMessages((cur) => {
        const i = cur.findIndex((x) => x.id === m.id);
        return i < 0 ? [...cur, m] : cur.map((x) => (x.id === m.id ? m : x));
      });
    const connect = async (): Promise<void> => {
      try {
        socket = await client.connect();
        attempt = 0;
        // Subscribe first, then read: nothing said in between is lost.
        socket.onEvent((f) => {
          const ev = f.payload as CoreEvent;
          if ((ev.type === "message.created" || ev.type === "message.updated") && ev.message.thread_id === HOME)
            upsert(ev.message);
          else if (ev.type === "message.part" && ev.thread_id === HOME)
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== ev.message_id) return m;
                const parts = [...m.parts];
                parts[ev.index] = ev.part;
                return { ...m, parts };
              }),
            );
        });
        setMessages((await client.call("threads.get", { thread: HOME })).messages);
        setOnline(true);
        await socket.closed;
      } catch (e) {
        // The key was revoked in the panel: back to pairing.
        if (e instanceof ApxError && e.code === "unauthorized") return onUnpair();
      }
      setOnline(false);
      if (stopped) return;
      setTimeout(() => void connect(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
    };
    void connect();
    return () => {
      stopped = true;
      socket?.close();
    };
  }, [client, onUnpair]);

  const send = () => {
    const words = text.trim();
    if (!words) return;
    setText("");
    client.call("threads.send", { thread: HOME, text: words }).catch(() => setText(words));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Text style={styles.status}>{online ? "APX" : t("offline")}</Text>
        <Button title={t("unpair")} onPress={onUnpair} />
      </View>
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.author.kind === "user";
          const words = item.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
          if (!words) return null;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={styles.text}>{words}</Text>
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={t("message")}
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Button title={t("send")} disabled={!online || !text.trim()} onPress={send} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12 },
  status: { fontSize: 17, fontWeight: "600" },
  bubble: { maxWidth: "85%", padding: 10, borderRadius: 14 },
  mine: { alignSelf: "flex-end", backgroundColor: "#e2f3e9" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#efeeea" },
  text: { fontSize: 15 },
  composer: { flexDirection: "row", gap: 8, padding: 12, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d6d4ce",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
