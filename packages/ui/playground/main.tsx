import { createRoot } from "react-dom/client";
import {
  ActionGroup, ActivityPill, AgentAvatar, AgentChip, ApxProvider, AvatarStack, Avatar, Badge, Button, Composer,
  ConversationRow, DayDivider, EntityCard, Icons, IconButton, Message, MessageMeta, NavItem, SearchField,
  SectionLabel, StepList, SystemNote, Tag, VoiceNote, SegmentedControl, type ApxLook, type ApxMode,
} from "../src";
import "../src/styles/tokens.css";
import "../src/styles/components.css";
import "../src/styles/components/flow.css";

function Screen({ look, mode }: { look: ApxLook; mode: ApxMode }) {
  const classic = look === "classic";
  return (
    <ApxProvider look={look} mode={mode} fill style={{ display: "flex", height: 760, border: "1px solid #8884", borderRadius: 14, overflow: "hidden" }}>
      <aside style={{ width: 280, background: "var(--apx-sidebar)", borderRight: "1px solid var(--apx-border)", padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
        <SearchField size="sm" shortcut={["⌘", "K"]} />
        <div style={{ height: 8 }} />
        <NavItem icon={<Icons.House />} label="Home" active />
        <NavItem icon={<Icons.Inbox />} label="Inbox" count={3} attention />
        <NavItem icon={<Icons.RefreshCw />} label="In progress" count={2} />
        <SectionLabel action={<IconButton label="New project" size="sm" icon={<Icons.Plus />} />}>Projects</SectionLabel>
        <NavItem icon={<Avatar name="Acme" shape="square" size={18} />} label="Acme" />
        <NavItem depth={1} label="Chat with agents" />
        <NavItem depth={1} label="Tasks · Board" />
        <SectionLabel>Chats</SectionLabel>
        <ConversationRow avatar={<AgentAvatar name="Roby" blob="noche" size={34} />} title="Roby" titleTag={<Tag kind="role">Super-agente</Tag>} time="1:29 p. m." preview="Listo: ya tengo las ideas del reel." selected tags={classic ? <><Tag icon={<Icons.Send />}>Telegram</Tag></> : undefined} />
        <ConversationRow avatar={<AgentAvatar name="Scout" blob="zafiro" size={34} />} title="Scout" time="10:34 a. m." preview="3 intros drafted in your voice" unread={2} />
        <ConversationRow avatar={<AvatarStack size={22}><AgentAvatar name="Ledger" blob="menta" size={22} animated={false} /><AgentAvatar name="Scout" blob="amatista" size={22} animated={false} /></AvatarStack>} title="Offsite crew" time="7:34 a. m." preview="that leaves the pipeline" typing={classic ? undefined : "Ledger is typing…"} tags={classic ? <><Tag icon={<Icons.Folder />}>Acme</Tag><Tag>Agente ↔ agente</Tag></> : undefined} />
      </aside>
      <main style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--apx-bg)", minWidth: 0 }}>
        <header style={{ height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid var(--apx-border)" }}>
          <AgentAvatar name="Outbound" blob="brasa" size={22} />
          <strong style={{ fontWeight: 500 }}>Outbound</strong>
          <span style={{ flex: 1 }} />
          <SegmentedControl size="sm" options={[{ value: "chat", label: "Chat" }, { value: "tasks", label: "Tasks" }]} />
          <IconButton label="Tools" icon={<Icons.Wrench />} active={classic} />
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 24px" }}>
          <DayDivider label="Today" />
          <Message>
            <StepList steps={[{ label: "CRM", detail: "list pulled · 52 accounts" }, { label: "Enrichment", detail: "3 lookalike segments" }, { label: "LinkedIn", detail: "4 profiles skipped", status: "failed" }, { label: "Sequencer", detail: "36 drafts queued", status: "running" }]} />
          </Message>
          <SystemNote>Messages from <AgentChip name="Ledger" blob="amatista" /> and <AgentChip name="Roby" blob="noche" tone="brand" /></SystemNote>
          <ActionGroup title="Actions 1–10 of 16" failed={2} items={[{ name: "crm.query", detail: "accounts where tier = A", aside: "0.8s" }, { name: "browser.open", detail: "linkedin.com/in/…", status: "failed", aside: "timeout" }]} defaultOpen={classic} />
          <Message meta={<MessageMeta agent="Outbound" model="codex:gpt-6.1" effort="medium" />}>
            The 36 drafts are sitting in the queue: recipient, opener, and a <Badge>Draft</Badge> badge on each.
          </Message>
          <Message variant="bare">
            <EntityCard eyebrow="Email draft" icon={<Icons.Mail />} status={<Badge tone="warning" dot>Needs review</Badge>} fields={[{ label: "To", value: "dana@northwind.co" }, { label: "Subject", value: "Three infra roles at Northwind" }]} actions={<><Button size="sm">Send email</Button><Button size="sm" variant="secondary">Discard</Button></>}>
              <p>Hi Dana, saw Northwind opened three infra roles this month.</p>
            </EntityCard>
          </Message>
          <Message from="user" reactions="👍">The top 10 look good. Send it. Run this every week.</Message>
          <SystemNote icon={<Icons.Clock />}>Created routine <b>Overnight outbound</b></SystemNote>
          <Message><VoiceNote duration={10} detail="42 KB" progress={0.3} /></Message>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <ActivityPill tone="danger" from={<AvatarStack size={24}><AgentAvatar name="Ledger" blob="menta" size={24} /><AgentAvatar name="Scout" blob="amatista" size={24} /></AvatarStack>} label="Sending to Roby…" to={<AgentAvatar name="Roby" blob="brasa" size={24} />} />
          </div>
        </div>
        <div style={{ padding: 12 }}>
          {classic ? (
            <Composer placeholder="Escribí algo y enter para enviar" onAttach={() => {}} header={<><span>◔ 2368.7k</span><span>⚒ 127</span></>} toolbar={<><Button size="sm" variant="ghost" leadingIcon={<Icons.Layers />}>Auto</Button><Button size="sm" variant="ghost" leadingIcon={<Icons.Zap />}>Interrumpe</Button></>} />
          ) : (
            <Composer placeholder="Message Outbound" onAttach={() => {}} />
          )}
        </div>
      </main>
    </ApxProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24, background: "#777", fontFamily: "system-ui" }}>
    <Screen look="minimal" mode="light" />
    <Screen look="minimal" mode="dark" />
    <Screen look="classic" mode="dark" />
    <Screen look="classic" mode="light" />
  </div>,
);
