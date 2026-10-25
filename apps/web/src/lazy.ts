// The one place panel code is loaded late (AGENTS.md rule 27): every lazy screen, dialog and part is declared here once,
// and the first screen imports it from here, never the module itself: biome.json names each file below and fails a
// static import of one from App, main, shell/, inbox/ or chat/ (a new entry adds its file there). The language chunks
// (i18n/messages.ts) and the marks (data/models.ts) are the two loaded elsewhere.
import { lazy } from "react";

// Windows of their own and the setup screens: the main window never loads them.
export const QuickChat = lazy(() => import("./quick/QuickChat.tsx").then((m) => ({ default: m.QuickChat })));
export const BrowserPanel = lazy(() => import("./panel/BrowserPanel.tsx").then((m) => ({ default: m.BrowserPanel })));
export const Wizard = lazy(() => import("./setup/Wizard.tsx").then((m) => ({ default: m.Wizard })));
export const PairScreen = lazy(() => import("./setup/PairScreen.tsx").then((m) => ({ default: m.PairScreen })));
export const ConnectScreen = lazy(() =>
  import("./setup/ConnectScreen.tsx").then((m) => ({ default: m.ConnectScreen })),
);
export const AboutScreen = lazy(() => import("./setup/AboutScreen.tsx").then((m) => ({ default: m.AboutScreen })));
export const ArtifactWindow = lazy(() =>
  import("./apps/ArtifactWindow.tsx").then((m) => ({ default: m.ArtifactWindow })),
);
export const OAuthReturn = lazy(() => import("./resources/OAuthReturn.tsx").then((m) => ({ default: m.OAuthReturn })));

// Screens and dialogs loaded when first opened: the chat is what the panel opens on.
export const AppScreen = lazy(() => import("./apps/AppScreen.tsx").then((m) => ({ default: m.AppScreen })));
export const ChannelScreen = lazy(() =>
  import("./channels/ChannelScreen.tsx").then((m) => ({ default: m.ChannelScreen })),
);
export const ConfigModal = lazy(() => import("./config/ConfigModal.tsx").then((m) => ({ default: m.ConfigModal })));
export const TaskPeek = lazy(() => import("./tasks/TaskPeek.tsx").then((m) => ({ default: m.TaskPeek })));
export const EngineSessions = lazy(() =>
  import("./engines/EngineSessions.tsx").then((m) => ({ default: m.EngineSessions })),
);
export const ProjectScreen = lazy(() =>
  import("./project/ProjectScreen.tsx").then((m) => ({ default: m.ProjectScreen })),
);
export const ResourcesScreen = lazy(() =>
  import("./project/ResourcesScreen.tsx").then((m) => ({ default: m.ResourcesScreen })),
);
export const InstallArtifactDialog = lazy(() =>
  import("./surfaces/InstallArtifact.tsx").then((m) => ({ default: m.InstallArtifactDialog })),
);
export const LiveLayer = lazy(() => import("./surfaces/LiveLayer.tsx").then((m) => ({ default: m.LiveLayer })));
export const WelcomeV2 = lazy(() => import("./shell/WelcomeV2.tsx").then((m) => ({ default: m.WelcomeV2 })));
export const CornerCards = lazy(() => import("./shell/CornerCards.tsx").then((m) => ({ default: m.CornerCards })));
export const CommandPalette = lazy(() =>
  import("./shell/CommandPalette.tsx").then((m) => ({ default: m.CommandPalette })),
);
export const ThreadDialogs = lazy(() =>
  import("./inbox/ThreadDialogs.tsx").then((m) => ({ default: m.ThreadDialogs })),
);
export const WidgetChatHost = lazy(() =>
  import("./surfaces/WidgetChat.tsx").then((m) => ({ default: m.WidgetChatHost })),
);
export const PhoneDialog = lazy(() => import("./shell/PhoneDialog.tsx").then((m) => ({ default: m.PhoneDialog })));
export const TasksScreen = lazy(() => import("./tasks/TasksScreen.tsx").then((m) => ({ default: m.TasksScreen })));
export const ComputersScreen = lazy(() =>
  import("./computers/ComputersScreen.tsx").then((m) => ({ default: m.ComputersScreen })),
);
export const UsageDialog = lazy(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageDialog })));
export const UsageSummary = lazy(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageSummary })));
// The memory gauge shows a number only after its first read: loading it after the first screen moves nothing shown.
export const UsageButton = lazy(() => import("./shell/UsageButton.tsx").then((m) => ({ default: m.UsageButton })));

// The sidebar's extras: not needed for the first paint.
export const AppsDock = lazy(() => import("./shell/AppsDock.tsx").then((m) => ({ default: m.AppsDock })));
export const DesktopInstallNotice = lazy(() =>
  import("./shell/DesktopInstallNotice.tsx").then((m) => ({ default: m.DesktopInstallNotice })),
);

// Project dialogs, opened rarely.
export const NewProjectDialog = lazy(() =>
  import("./shell/NewProjectDialog.tsx").then((m) => ({ default: m.NewProjectDialog })),
);
export const UnregisterProjectDialog = lazy(() =>
  import("./shell/UnregisterProjectDialog.tsx").then((m) => ({ default: m.UnregisterProjectDialog })),
);
export const ProjectSettings = lazy(() =>
  import("./project/ProjectSettings.tsx").then((m) => ({ default: m.ProjectSettings })),
);

export const JobList = lazy(() => import("./shell/JobList.tsx").then((m) => ({ default: m.JobList })));

export const CoreBehind = lazy(() => import("./shell/CoreBehind.tsx").then((m) => ({ default: m.CoreBehind })));
export const UpdateDialog = lazy(() => import("./shell/UpdateDialog.tsx").then((m) => ({ default: m.UpdateDialog })));

// The side panel's tabs load when first opened, not with the chat.
export const ChatFiles = lazy(() => import("./panel/ChatFiles.tsx").then((m) => ({ default: m.ChatFiles })));
export const UsagePanel = lazy(() => import("./panel/UsagePanel.tsx").then((m) => ({ default: m.UsagePanel })));
export const ChangesPanel = lazy(() => import("./panel/ChangesPanel.tsx").then((m) => ({ default: m.ChangesPanel })));
export const ProcessesPanel = lazy(() =>
  import("./panel/ProcessesPanel.tsx").then((m) => ({ default: m.ProcessesPanel })),
);
export const TerminalPanel = lazy(() =>
  import("./panel/TerminalPanel.tsx").then((m) => ({ default: m.TerminalPanel })),
);
export const WidgetPanel = lazy(() => import("./panel/WidgetPanel.tsx").then((m) => ({ default: m.WidgetPanel })));
export const AgentPanel = lazy(() => import("./panel/AgentPanel.tsx").then((m) => ({ default: m.AgentPanel })));
export const DocumentPanel = lazy(() =>
  import("./panel/DocumentPanel.tsx").then((m) => ({ default: m.DocumentPanel })),
);
export const ComputerPanel = lazy(() =>
  import("./panel/ComputerPanel.tsx").then((m) => ({ default: m.ComputerPanel })),
);

// xterm.js loads with the first terminal opened, not with the panel.
export const TerminalView = lazy(() => import("./panel/TerminalView.tsx"));

// Computer use shows only in the desktop app; a contact's chat brings the channel's conversation and card.
export const ScreenLive = lazy(() => import("./chat/ScreenLive.tsx").then((m) => ({ default: m.ScreenLive })));
export const ComputerNotice = lazy(() =>
  import("./computers/ComputerNotice.tsx").then((m) => ({ default: m.ComputerNotice })),
);
export const ComputerProgress = lazy(() =>
  import("./computers/ComputerProgress.tsx").then((m) => ({ default: m.ComputerProgress })),
);
export const ContactChat = lazy(() => import("./channels/ContactChat.tsx").then((m) => ({ default: m.ContactChat })));

// Message parts load with the first message that has one, not with the chat.
export const SurfacePart = lazy(() => import("./chat/parts/SurfacePart.tsx").then((m) => ({ default: m.SurfacePart })));
export const ChoicesPart = lazy(() => import("./chat/parts/ChoicesPart.tsx").then((m) => ({ default: m.ChoicesPart })));
export const ConnectPart = lazy(() => import("./chat/parts/ConnectPart.tsx").then((m) => ({ default: m.ConnectPart })));
export const MediaGroup = lazy(() => import("./chat/parts/MediaGroup.tsx"));
export const InputPart = lazy(() => import("./chat/parts/InputPart.tsx").then((m) => ({ default: m.InputPart })));

export const AudioPlayer = lazy(() => import("./chat/parts/AudioPart.tsx").then((m) => ({ default: m.AudioPart })));

export const DelegationActions = lazy(() =>
  import("./chat/parts/DelegationActions.tsx").then((m) => ({ default: m.DelegationActions })),
);
export const GoOn = lazy(() => import("./chat/parts/GoOn.tsx").then((m) => ({ default: m.GoOn })));

export const DocumentActions = lazy(() =>
  import("./panel/DocumentActions.tsx").then((m) => ({ default: m.DocumentActions })),
);

// The run button and its terminal load the first time a chat shows a shell block.
export const RunnableCode = lazy(() => import("./chat/RunnableCode.tsx").then((m) => ({ default: m.RunnableCode })));
export const ReceivedDialog = lazy(() =>
  import("./chat/ReceivedDialog.tsx").then((m) => ({ default: m.ReceivedDialog })),
);

// A model picker's list shows only once it opens (the composer has a picker).
export const ModelList = lazy(() => import("./config/models/ModelList.tsx").then((m) => ({ default: m.ModelList })));

// The editor and its languages load when the first text file opens.
export const CodeView = lazy(() => import("./project/files/CodeView.tsx").then((m) => ({ default: m.CodeView })));

// The searchable picker (base-ui's combobox) loads after the first paint: the inbox's new-chat button has one.
export const SearchSelect = lazy(() =>
  import("./common/pickers/SearchSelect.tsx").then((m) => ({ default: m.SearchSelect })),
);

export const QrSvg = lazy(() => import("./common/QrSvg.tsx").then((m) => ({ default: m.QrSvg })));

// Plain modules loaded on first use.
export const loadOsNotices = () => import("./shell/osNotices.ts");
export const loadSounds = () => import("./shell/sounds.ts");
