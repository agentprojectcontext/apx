import type { Agent } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { ProfilePicker } from "../../../config/ProfilePicker.tsx";
import { DEFAULT_PID } from "../../../data/identity.ts";
import { useT } from "../../../i18n/index.ts";
import { go } from "../../../shell/nav.ts";

/** The super-agent's profile, the same picker as Settings › Super-agent; it applies at once, apart from Save. */
export function ProfilePage({ agent, onClose }: { agent: Agent; onClose(): void }) {
  const t = useT();
  const leave = (to: () => void) => {
    onClose();
    to();
  };
  return (
    <ProfilePicker
      actions={
        <div className="agentedit__links">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.Calendar size={14} />}
            onClick={() => leave(() => go.project(agent.project_id ?? DEFAULT_PID, "routines"))}
          >
            {t("agentedit.profile.routines")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.Settings size={14} />}
            onClick={() => leave(() => go.config("profile"))}
          >
            {t("agentedit.profile.settings")}
          </Button>
        </div>
      }
    />
  );
}
