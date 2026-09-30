import { ApxProvider, Button, Icons } from "@apx/ui";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const };

export function Variants() {
  return (
    <div style={row}>
      <Button>Send email</Button>
      <Button variant="secondary">Discard</Button>
      <Button variant="outline">Preview</Button>
      <Button variant="ghost" leadingIcon={<Icons.Layers />}>
        Auto
      </Button>
      <Button variant="danger" leadingIcon={<Icons.Trash2 />}>
        Delete
      </Button>
      <Button variant="link">View log</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Get started for free</Button>
    </div>
  );
}

export function States() {
  return (
    <div style={row}>
      <Button loading>Connecting</Button>
      <Button disabled>Disabled</Button>
      <Button variant="secondary" trailingIcon={<Icons.ChevronDown />}>
        Codex · medium
      </Button>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <div style={row}>
        <Button>Send email</Button>
        <Button variant="secondary">Discard</Button>
        <Button variant="outline">Preview</Button>
        <Button variant="ghost" leadingIcon={<Icons.Zap />}>
          Interrumpe
        </Button>
      </div>
    </ApxProvider>
  );
}
