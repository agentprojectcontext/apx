import { ApxProvider, IconButton, Icons } from "@apx/ui";

const row = { display: "flex", gap: 8, alignItems: "center" };

export function Toolbar() {
  return (
    <div style={row}>
      <IconButton label="New chat" icon={<Icons.SquarePen />} />
      <IconButton label="Tools" icon={<Icons.Wrench />} active />
      <IconButton label="Language" icon={<Icons.Languages />} />
      <IconButton label="More" icon={<Icons.Ellipsis />} />
    </div>
  );
}

export function Variants() {
  return (
    <div style={row}>
      <IconButton
        label="Back"
        icon={<Icons.ChevronRight style={{ transform: "rotate(180deg)" }} />}
        variant="outline"
        shape="circle"
      />
      <IconButton label="Attach" icon={<Icons.Plus />} variant="secondary" shape="circle" />
      <IconButton label="Voice" icon={<Icons.Mic />} variant="primary" shape="circle" />
      <IconButton label="Send" icon={<Icons.ArrowUp />} variant="primary" shape="circle" size="lg" />
      <IconButton label="Close" icon={<Icons.X />} size="sm" />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 12, borderRadius: 12 }}>
      <div style={row}>
        <IconButton label="Tools" icon={<Icons.Wrench />} variant="secondary" active />
        <IconButton label="Reload" icon={<Icons.RotateCcw />} />
        <IconButton label="Send" icon={<Icons.ArrowUp />} variant="primary" size="sm" />
      </div>
    </ApxProvider>
  );
}
