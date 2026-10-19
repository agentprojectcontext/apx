import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../apps/core/src/config.ts";
import { createCore } from "../apps/core/src/server.ts";

const record = process.env.E2E_DESKTOP_TRASH_RECORD;
if (!record) throw new Error("E2E_DESKTOP_TRASH_RECORD is required");
const config = loadConfig();
const core = await createCore(config, {
  desktop: {
    reveal: async () => {},
    open: async () => {},
    trash: async (abs) => {
      fs.appendFileSync(record, `${JSON.stringify(abs)}\n`);
      const fakeTrash = `${record}.trash`;
      fs.mkdirSync(fakeTrash, { recursive: true });
      fs.renameSync(abs, `${fakeTrash}/${path.basename(abs)}-${Date.now()}`);
    },
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await core.close();
    process.exit(0);
  });
}
