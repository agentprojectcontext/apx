import { ApxProvider, MessageMeta } from "@apx/ui";

export function Default() {
  return <MessageMeta agent="Roby" model="codex:gpt-6.1-sol" effort="medium" />;
}

export function WithExtras() {
  return (
    <MessageMeta agent="Outbound" model="claude:opus" effort="high">
      <span>· 2 min · 14.2k tokens</span>
    </MessageMeta>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 12, borderRadius: 10 }}>
      <MessageMeta agent="Roby" model="chatgpt-codex:gpt-6.1-sol" effort="medium" />
    </ApxProvider>
  );
}
