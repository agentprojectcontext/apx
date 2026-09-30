import { AgentAvatar, ApxProvider, Message, MessageMeta, StepList } from "@apx/ui";

const thread = { width: 560, display: "flex", flexDirection: "column" as const };

export function Thread() {
  return (
    <div style={thread}>
      <Message>
        <p>
          Ledger sent over the Acme and Globex threads and Roby flagged the priority accounts. Both are folded into
          tonight's list.
        </p>
      </Message>
      <Message grouped>
        <p>
          The 36 drafts are sitting in the queue: recipient, opener, and a Draft badge on each. Nothing goes out until
          you've had a look.
        </p>
      </Message>
      <Message from="user" reactions="👍">
        The top 10 look good. Send it. Run this every week.
      </Message>
      <Message meta={<MessageMeta agent="Outbound" model="codex:gpt-6.1" effort="medium" />}>Done.</Message>
    </div>
  );
}

export function RichBody() {
  return (
    <div style={thread}>
      <Message>
        <StepList
          steps={[
            { label: "CRM", detail: "list pulled · 52 accounts" },
            { label: "Enrichment", detail: "3 lookalike segments pulled" },
            { label: "LinkedIn", detail: "4 profiles skipped · recently contacted" },
            { label: "Sequencer", detail: "36 drafts queued · 0 sent" },
          ]}
        />
      </Message>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 600 }}>
      <Message
        avatar={<AgentAvatar name="Roby" blob="noche" size={22} />}
        meta={<MessageMeta agent="Roby" model="codex:gpt-6.1-sol" effort="medium" />}
      >
        <p>Corregí lo anterior: la tarea estaba marcada en curso, pero no había producción activa.</p>
        <p>Ahora sí dejé la ejecución corriendo con Albert sobre la misma tarea, sin publicar.</p>
      </Message>
      <Message from="user">¿seguís?</Message>
    </ApxProvider>
  );
}
