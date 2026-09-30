import { ActionGroup, ApxProvider, Icons } from "@apx/ui";

const items = [
  { name: "crm.query", detail: "accounts where tier = A", aside: "0.8s" },
  { name: "files.read", detail: "acme/playbook.md", aside: "12 KB" },
  { name: "browser.open", detail: "linkedin.com/in/dana-northwind", status: "failed" as const, aside: "timeout" },
  { name: "sequencer.queue", detail: "36 drafts", status: "running" as const },
];

export function Collapsed() {
  return (
    <div style={{ width: 520, display: "flex", flexDirection: "column", gap: 8 }}>
      <ActionGroup title="Actions 1–10 of 16" items={items} />
      <ActionGroup title="Actions 11–16 of 16" failed={2} items={items} />
    </div>
  );
}

export function Expanded() {
  return (
    <div style={{ width: 520 }}>
      <ActionGroup title="Worked 2 min" failed={1} items={items} defaultOpen />
    </div>
  );
}

export function Reasoning() {
  return (
    <div style={{ width: 520 }}>
      <ActionGroup title="Thought for 14s" icon={<Icons.Sparkles size={14} />} defaultOpen>
        <p style={{ margin: "0 12px 10px 34px", fontSize: 13, color: "var(--apx-fg-muted)" }}>
          The task says "in progress" but there's no running job. Check the job table first, then restart the render
          with the same brief.
        </p>
      </ActionGroup>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 560 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ActionGroup title="Acciones 1–10 de 16" failedLabel="fallaron" items={items} />
        <ActionGroup title="Acciones 11–16 de 16" failed={2} failedLabel="fallaron" items={items} defaultOpen />
      </div>
    </ApxProvider>
  );
}
