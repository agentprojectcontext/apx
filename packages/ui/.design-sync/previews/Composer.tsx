import { ApxProvider, Button, Composer, Icons } from "@apx/ui";

export function Pill() {
  return (
    <div style={{ width: 520 }}>
      <Composer placeholder="Message Outbound" onAttach={() => {}} />
    </div>
  );
}

export function PillWithText() {
  return (
    <div style={{ width: 520 }}>
      <Composer defaultValue="Send the top 10, they look good" onAttach={() => {}} />
    </div>
  );
}

export function BoxWithToolbar() {
  return (
    <div style={{ width: 560 }}>
      <Composer
        placeholder="Write something — Enter sends, Shift+Enter adds a line"
        onAttach={() => {}}
        header={
          <>
            <span>◔ 2368.7k</span>
            <span>⚒ 127</span>
          </>
        }
        toolbar={
          <>
            <Button size="sm" variant="ghost" leadingIcon={<Icons.Layers />}>
              Auto
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<Icons.Zap />}>
              Interrupt
            </Button>
          </>
        }
      />
    </div>
  );
}

export function Busy() {
  return (
    <div style={{ width: 520 }}>
      <Composer placeholder="Roby is answering…" defaultValue="" busy onAttach={() => {}} />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 592 }}>
      <Composer
        placeholder="Escribí algo y enter para enviar (shift+enter = nueva línea)"
        onAttach={() => {}}
        header={
          <>
            <span>◔ 2368.7k</span>
            <span>⚒ 127</span>
          </>
        }
        toolbar={
          <>
            <Button size="sm" variant="ghost" leadingIcon={<Icons.Layers />}>
              Auto
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<Icons.Zap />}>
              Interrumpe
            </Button>
          </>
        }
      />
    </ApxProvider>
  );
}
