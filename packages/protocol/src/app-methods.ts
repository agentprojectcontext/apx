// Methods behind the app screens: agents, projects, threads, surfaces.

import { appAccountMethods } from "./app-methods-account.ts";
import { appConnectionsMethods } from "./app-methods-connections.ts";
import { appConversationMethods } from "./app-methods-conversation.ts";
import { appMediaMethods } from "./app-methods-media.ts";
import { appSetupMethods } from "./app-methods-setup.ts";

export { PanelMode, SetupPrepare } from "./app-methods-setup.ts";

import { appWorkspaceMethods } from "./app-methods-workspace.ts";

export const appMethods = {
  ...appSetupMethods,
  ...appWorkspaceMethods,
  ...appConversationMethods,
  ...appAccountMethods,
  ...appConnectionsMethods,
  ...appMediaMethods,
} as const;
