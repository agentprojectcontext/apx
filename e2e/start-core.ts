import { loadConfig } from "../apps/core/src/config.ts";
import { createCore } from "../apps/core/src/server.ts";
import { fakeDesktopTrash } from "./fake-desktop-trash.ts";

const record = process.env.E2E_DESKTOP_TRASH_RECORD;
const projectRoot = process.env.E2E_PROJECT_ROOT;
if (!record || !projectRoot) throw new Error("E2E_DESKTOP_TRASH_RECORD and E2E_PROJECT_ROOT are required");
const config = loadConfig();
const core = await createCore(config, {
  desktop: {
    reveal: async () => {},
    open: async () => {},
    trash: fakeDesktopTrash(projectRoot, record),
  },
  // A Linux VM that is always on, so the usage views show its slot.
  vmUsage: () => ({
    running: true,
    name: "Linux VM",
    cpus: 4,
    memory_assigned_mb: 4096,
    memory_used_mb: 1536,
    disk_mb: 8200,
  }),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await core.close();
    process.exit(0);
  });
}
