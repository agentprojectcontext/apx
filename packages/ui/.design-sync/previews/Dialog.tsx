import { ApxProvider, Button, Dialog, Input } from "@apx/ui";

// The dialog is position:fixed; a transformed provider becomes its containing block,
// so the open dialog and backdrop render inside this frame instead of the viewport.
const frame = {
  position: "relative" as const,
  transform: "translateZ(0)",
  width: 520,
  height: 320,
  borderRadius: 12,
  overflow: "hidden",
};

export function Confirm() {
  return (
    <ApxProvider fill style={frame}>
      <Dialog
        defaultOpen
        size="sm"
        title="Delete routine?"
        description="Overnight outbound stops running. Past runs stay in the log."
        footer={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button variant="danger">Delete</Button>
          </>
        }
      />
    </ApxProvider>
  );
}

export function Form() {
  return (
    <ApxProvider fill style={{ ...frame, height: 380 }}>
      <Dialog
        defaultOpen
        title="New project"
        description="Point APX at a folder. Agents and memory live in its .apc/ directory."
        footer={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button>Create project</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input placeholder="Name" defaultValue="Acme" />
          <Input placeholder="Folder" defaultValue="~/work/acme" />
        </div>
      </Dialog>
    </ApxProvider>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={frame}>
      <Dialog
        defaultOpen
        size="sm"
        title="¿Borrar la rutina?"
        description="Deja de correr. Las ejecuciones pasadas quedan en el log."
        footer={
          <>
            <Button variant="secondary">Cancelar</Button>
            <Button variant="danger">Borrar</Button>
          </>
        }
      />
    </ApxProvider>
  );
}
