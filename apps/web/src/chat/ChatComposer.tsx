import type { Agent, Message, Thread } from "@apx/protocol";
import { Composer, Icons } from "@apx/ui";
import { cancel, send } from "../data/actions.ts";
import { isWorking } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go } from "../shell/nav.ts";

const EMPTY: Message[] = [];

export function ChatComposer({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const offline = useData((s) => s.connection === "offline");
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const model = [...messages].reverse().find((m) => m.model)?.model ?? agent?.model;
  const busy = isWorking(thread.state);
  return (
    <div className="chat__composer">
      <Composer
        placeholder={offline ? "Sin conexión con el core…" : `Escribile a ${agent?.name ?? "tu agente"}…`}
        disabled={offline}
        busy={busy}
        onStop={() => void cancel(thread.id)}
        onSubmit={(text) => void send(thread.id, text.trim()).catch(() => {})}
        toolbar={
          <>
            {model && (
              <span className="composer__model" title="Modelo de la última respuesta">
                <Icons.Sparkles size={12} />
                {model}
              </span>
            )}
            <span className="composer__spacer" />
            <button type="button" className="composer__usage" onClick={() => go.panel("usage")}>
              Consumo
            </button>
          </>
        }
      />
    </div>
  );
}
