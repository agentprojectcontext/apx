import { Button, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ClientsBlock } from "./ClientsBlock.tsx";
import { SectionHead } from "./SectionHead.tsx";

/** MCP now lives in Resources; Config keeps the outside apps (client tokens) and a way there. */
export function McpSection() {
  const t = useT();
  return (
    <>
      <SectionHead title={t("config.outsideApps")} lead={t("config.movedMcp")} />
      <MovedCard onOpen={() => go.resources("mcp", true)} label={t("config.openResourcesMcp")} />
      <ClientsBlock />
    </>
  );
}

/** Extensions now live in Resources (last tab). */
export function ExtensionsMoved() {
  const t = useT();
  return (
    <>
      <SectionHead title={t("config.extensions")} lead={t("config.movedExtensions")} />
      <MovedCard onOpen={() => go.resources("extensions", true)} label={t("config.openResourcesExtensions")} />
    </>
  );
}

function MovedCard({ onOpen, label }: { onOpen(): void; label: string }) {
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        trailingIcon={<Icons.ChevronRight size={14} />}
        onClick={() => {
          go.config(null);
          onOpen();
        }}
      >
        {label}
      </Button>
    </div>
  );
}
