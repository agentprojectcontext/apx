import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelChoice } from "../chat/models";
import type { Creds } from "../creds";
import {
  type Answer,
  ApxClient,
  ApxError,
  type ApxSocket,
  type CoreEvent,
  type Message,
  type Thread,
} from "../protocol";

type Usage = { context?: number; window?: number };
/** The newest run that reported how full the chat is. */
const usageOf = (runs: Array<{ started_at: string; usage?: Usage }>) =>
  [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).find((run) => run.usage?.context)?.usage;

import { APP_CLIENT } from "../appInfo";
import { isNewChat } from "../chat/newChat";
import { isWorking } from "./chatSelectors";

function upsert(messages: Message[], message: Message, matchOptimistic = true): Message[] {
  const realText =
    matchOptimistic &&
    !message.id.startsWith("local_") &&
    !messages.some((item) => item.id === message.id) &&
    message.author.kind === "user"
      ? message.parts.find((part) => part.type === "text")?.text
      : undefined;
  // A streamed acknowledgement replaces one pending send, never every send with the same words.
  const optimistic = realText
    ? messages.find(
        (item) =>
          item.id.startsWith("local_") && item.parts.some((part) => part.type === "text" && part.text === realText),
      )
    : undefined;
  return [...messages.filter((item) => item.id !== message.id && item.id !== optimistic?.id), message].sort(
    (a, b) => a.seq - b.seq,
  );
}

/** Subscribe before loading, fold streamed messages, and reconnect after interruptions. */
function useThreadFeed(client: ApxClient, threadId: string, onUnpair: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState(false);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [thread, setThread] = useState<Thread>();
  const [usage, setUsage] = useState<Usage>();
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let socket: ApxSocket | undefined;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refetch: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const changes = new Map<string, Message>();
    const lastSeq = new Map<string, number>();
    const deleted = new Set<string>();
    let loadVersion = 0;
    let stateVersion = 0;
    const load = async () => {
      // A new chat is not in the core until its first message: the socket only says whether the core is reachable.
      if (isNewChat(threadId)) return;
      const requestVersion = ++loadVersion;
      const requestStateVersion = stateVersion;
      try {
        const result = await client.call("threads.get", { thread: threadId });
        if (stopped || requestVersion !== loadVersion) return;
        if (requestStateVersion === stateVersion) {
          setState(result.thread.state);
          setThread(result.thread);
        }
        setUsage(usageOf(result.runs));
        setMessages((current) => {
          let merged = [...result.messages, ...current.filter((message) => message.id.startsWith("local_"))];
          for (const message of changes.values()) merged = upsert(merged, message);
          return merged.filter((message) => !deleted.has(message.id)).sort((a, b) => a.seq - b.seq);
        });
        setError("");
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApxError && err.code === "unauthorized") {
          stopped = true;
          socket?.close();
          setOnline(false);
          onUnpair();
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reload.current = load;
    const scheduleLoad = () => {
      if (!refetch)
        refetch = setTimeout(() => {
          refetch = undefined;
          void load();
        }, 300);
    };
    const connect = async (): Promise<void> => {
      try {
        const connected = await client.connect();
        if (stopped) {
          connected.close();
          return;
        }
        socket = connected;
        attempt = 0;
        lastSeq.clear();
        socket.onEvent((frame) => {
          if (stopped || frame.stream !== "core") return;
          const previous = lastSeq.get(frame.stream);
          lastSeq.set(frame.stream, frame.seq);
          if (previous !== undefined && frame.seq !== previous + 1) scheduleLoad();
          const event = frame.payload as CoreEvent;
          if (event.type === "thread.updated" && event.thread.id === threadId) {
            stateVersion++;
            setState(event.thread.state);
            setThread(event.thread);
          } else if (event.type === "run.updated" && event.run.thread_id === threadId && event.run.usage?.context) {
            setUsage(event.run.usage);
          } else if (
            (event.type === "message.created" || event.type === "message.updated") &&
            event.message.thread_id === threadId
          ) {
            changes.set(event.message.id, event.message);
            setMessages((current) => upsert(current, event.message));
          } else if (event.type === "message.part" && event.thread_id === threadId) {
            setMessages((current) => {
              const message = current.find((item) => item.id === event.message_id);
              if (!message) {
                scheduleLoad();
                return current;
              }
              const parts = [...message.parts];
              parts[event.index] = event.part;
              const updated = { ...message, parts };
              changes.set(updated.id, updated);
              return upsert(current, updated);
            });
          } else if (event.type === "message.deleted" && event.thread_id === threadId) {
            for (const id of event.message_ids) {
              deleted.add(id);
              changes.delete(id);
            }
            setMessages((current) => current.filter((message) => !deleted.has(message.id)));
          }
        });
        await load();
        if (stopped) return;
        setOnline(true);
        await socket.closed;
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApxError && err.code === "unauthorized") {
          onUnpair();
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
      if (!stopped) {
        setOnline(false);
        const waits = [1000, 2000, 5000, 10000];
        retry = setTimeout(() => void connect(), waits[Math.min(attempt++, waits.length - 1)]);
      }
    };
    setMessages([]);
    setThread(undefined);
    setUsage(undefined);
    setState("idle");
    setError("");
    setOnline(false);
    void connect();
    return () => {
      stopped = true;
      socket?.close();
      if (retry) clearTimeout(retry);
      if (refetch) clearTimeout(refetch);
    };
  }, [client, threadId, onUnpair]);

  return { messages, setMessages, online, state, setState, error, setError, reload, thread, setThread, usage };
}

/** Native counterpart of the web's live store: subscribe, load, fold events, recover missing parts. */
export function useThread(creds: Creds, threadId: string, onUnpair: () => void) {
  const client = useMemo(() => new ApxClient({ url: creds.url, token: creds.token, client: APP_CLIENT }), [creds]);
  const sequence = useRef(0);
  const [stopping, setStopping] = useState(false);
  const stopPending = useRef(false);
  const { messages, setMessages, online, state, setState, error, setError, reload, thread, setThread, usage } =
    useThreadFeed(client, threadId, onUnpair);
  const send = useCallback(
    async (text: string, attachments: string[] = []) => {
      const local: Message = {
        id: `local_${randomUUID()}`,
        thread_id: threadId,
        seq: Date.now() + sequence.current++ / 1000,
        author: { kind: "user" },
        parts: [{ type: "text", text }],
        created_at: new Date().toISOString(),
      };
      setMessages((current) => upsert(current, local));
      try {
        const result = await client.call("threads.send", {
          thread: threadId,
          text,
          // Written while the agent works, it joins that turn instead of cutting it (the core queues it when it can't).
          mode: isWorking(state) ? "steer" : "queue",
          ...(attachments.length ? { attachments } : {}),
        });
        setMessages((current) =>
          upsert(
            current.filter((message) => message.id !== local.id),
            result.message,
            false,
          ),
        );
        setState((current) => (isWorking(current) ? current : "submitted"));
        setError("");
      } catch (err) {
        setMessages((current) => current.filter((message) => message.id !== local.id));
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [client, state, threadId, setMessages, setState, setError],
  );
  const stop = useCallback(async () => {
    if (stopPending.current) return;
    stopPending.current = true;
    setStopping(true);
    try {
      await client.call("threads.cancel", { thread: threadId });
      await reload.current();
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      stopPending.current = false;
      setStopping(false);
    }
  }, [client, threadId, reload, setError]);
  const respond = useCallback(
    async (input: string, answer: Answer) => {
      await client.call("runs.respond", { input, ...answer });
      await reload.current();
    },
    [client, reload],
  );
  /** The chat's own model; null goes back to the agent's. */
  const setModel = useCallback(
    async (choice: ModelChoice | null) => {
      const result = await client.call("threads.model", { thread: threadId, model_choice: choice });
      setThread((current) => (current ? { ...current, model_choice: result.model_choice } : current));
    },
    [client, threadId, setThread],
  );
  return { messages, online, state, error, send, respond, stop, stopping, thread, usage, setModel, client };
}
