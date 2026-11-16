import type { Agent } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { ProfilePicker } from "../../../config/ProfilePicker.tsx";
import { DEFAULT_PID } from "../../../data/identity.ts";
import { useT } from "../../../i18n/index.ts";
import { go } from "../../../shell/nav.ts";

/** The super-agent's profile: pick one or install one; it applies at once, apart from Save. */
export function ProfilePage({ agent, onClose }: { agent: Agent; onClose(): void }) {
  const t = useT();
  return (
    <ProfilePicker
      actions={
        <div className="agentedit__links">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.Calendar size={14} />}
            onClick={() => {
              onClose();
              go.project(agent.project_id ?? DEFAULT_PID, "routines");
            }}
          >
            {t("agentedit.profile.routines")}
          </Button>
        </div>
      }
    />
  );
}
