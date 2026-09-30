import { ApxProvider, Textarea } from "@apx/ui";

export function Default() {
  return (
    <div style={{ width: 380 }}>
      <Textarea placeholder="What should this agent focus on?" rows={4} />
    </div>
  );
}

export function Filled() {
  return (
    <div style={{ width: 380 }}>
      <Textarea
        rows={4}
        defaultValue={"You are Outbound. Draft cold emails in my voice.\nNever send without approval."}
      />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 412 }}>
      <Textarea rows={3} placeholder="Instrucciones del agente" />
    </ApxProvider>
  );
}
