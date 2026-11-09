// The one place panel code is loaded late (AGENTS.md rule 27): every lazy screen, dialog and part is declared here once,
// and the first screen imports it from here, never the module itself: biome.json names each file below and fails a
// static import of one from App, main, shell/, inbox/ or chat/ (a new entry adds its file there). The language chunks
// (i18n/messages.ts) and the marks (data/models.ts) are the two loaded elsewhere.
import { lazy } from "react";
import { addPack } from "./i18n/index.ts";
import type { Pack } from "./i18n/messages.ts";

/** A screen whose strings come in packs (i18n/messages.ts) opens once they are here, so it never shows a bare key. */
function withPacks<T>(packs: Pack[], load: () => Promise<T>): () => Promise<T> {
  return () => Promise.all([load(), ...packs.map((pack) => addPack(pack))]).then(([module]) => module);
}

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
export const OAuthReturn = lazy(
  withPacks(["resources"], () => import("./resources/OAuthReturn.tsx").then((m) => ({ default: m.OAuthReturn }))),
);

export const AttachChips = lazy(() =>
  import("./chat/composer/AttachChips.tsx").then((m) => ({ default: m.AttachChips })),
);

// Screens and dialogs loaded when first opened: the chat is what the panel opens on.
export const AppScreen = lazy(() => import("./apps/AppScreen.tsx").then((m) => ({ default: m.AppScreen })));
export const ChannelScreen = lazy(
  withPacks(["resources"], () => import("./channels/ChannelScreen.tsx").then((m) => ({ default: m.ChannelScreen }))),
);
export const ChannelsScreen = lazy(() =>
  import("./channels/ChannelsScreen.tsx").then((m) => ({ default: m.ChannelsScreen })),
);
export const ChannelDialogs = lazy(
  withPacks(["resources"], () =>
    import("./channels/account/AccountDialog.tsx").then((m) => ({ default: m.ChannelDialogs })),
  ),
);
export const ConfigModal = lazy(
  withPacks(["team"], () => import("./config/ConfigModal.tsx").then((m) => ({ default: m.ConfigModal }))),
);
export const TaskPeek = lazy(() => import("./tasks/TaskPeek.tsx").then((m) => ({ default: m.TaskPeek })));
// Shown on hover or click over the first screen, loaded when first needed: the super-agent's card, what fills a chat's
// context, a side question, a channel account's header, and the tooltips that replace native titles.
export const SuperAgentCard = lazy(() =>
  import("./shell/SuperAgentCard.tsx").then((m) => ({ default: m.SuperAgentCard })),
);
export const ContextCard = lazy(() =>
  import("./chat/composer/ContextCard.tsx").then((m) => ({ default: m.ContextCard })),
);
export const AsidePanel = lazy(() => import("./chat/composer/AsidePanel.tsx").then((m) => ({ default: m.AsidePanel })));
export const AccountHeader = lazy(() =>
  import("./inbox/AccountHeader.tsx").then((m) => ({ default: m.AccountHeader })),
);
export const TitleTooltips = lazy(() =>
  import("./common/TitleTooltips.tsx").then((m) => ({ default: m.TitleTooltips })),
);
// A message link's right-click menu, or an app link's button.
export const MessageLink = lazy(() => import("./chat/LinkMenu.tsx").then((m) => ({ default: m.MessageLink })));
// Parts only some messages carry and a task chat's header pieces.
export const ChangesPart = lazy(() => import("./chat/parts/ChangesPart.tsx").then((m) => ({ default: m.ChangesPart })));
export const SkillsPart = lazy(
  withPacks(["resources"], () => import("./chat/parts/SkillsPart.tsx").then((m) => ({ default: m.SkillsPart }))),
);
export const ImageGenerationPreview = lazy(() =>
  import("./chat/parts/ImageGenerationPreview.tsx").then((m) => ({ default: m.ImageGenerationPreview })),
);
export const TaskCrumb = lazy(() => import("./chat/TaskHeader.tsx").then((m) => ({ default: m.TaskCrumb })));
export const TaskStateButton = lazy(() =>
  import("./chat/TaskHeader.tsx").then((m) => ({ default: m.TaskStateButton })),
);
export const PlusMenu = lazy(() => import("./chat/composer/PlusMenu.tsx").then((m) => ({ default: m.PlusMenu })));
export const AttentionList = lazy(() =>
  import("./shell/AttentionList.tsx").then((m) => ({ default: m.AttentionList })),
);
// The Inbox filter's popover body (tabs, lists and the view picker), loaded when it first opens.
export const InboxFilterBody = lazy(() =>
  import("./inbox/InboxFilterBody.tsx").then((m) => ({ default: m.InboxFilterBody })),
);
export const TaskBundle = lazy(() => import("./inbox/TaskBundle.tsx").then((m) => ({ default: m.TaskBundle })));
export const SubthreadPart = lazy(() =>
  import("./chat/parts/SubthreadPart.tsx").then((m) => ({ default: m.SubthreadPart })),
);
export const AgentEvent = lazy(() => import("./chat/AgentEvent.tsx").then((m) => ({ default: m.AgentEvent })));
export const TaskDescription = lazy(() =>
  import("./chat/TaskDescription.tsx").then((m) => ({ default: m.TaskDescription })),
);
export const EngineSessions = lazy(() =>
  import("./engines/EngineSessions.tsx").then((m) => ({ default: m.EngineSessions })),
);
export const ProjectScreen = lazy(
  withPacks(["team", "resources"], () =>
    import("./project/ProjectScreen.tsx").then((m) => ({ default: m.ProjectScreen })),
  ),
);
export const ResourcesScreen = lazy(
  withPacks(["resources"], () => import("./project/ResourcesScreen.tsx").then((m) => ({ default: m.ResourcesScreen }))),
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
export const FilesScreen = lazy(() => import("./files/FilesScreen.tsx").then((m) => ({ default: m.FilesScreen })));
export const ComputersScreen = lazy(() =>
  import("./computers/ComputersScreen.tsx").then((m) => ({ default: m.ComputersScreen })),
);
export const UsageDialog = lazy(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageDialog })));
export const UsageSummary = lazy(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageSummary })));
export const RunningIndicator = lazy(() =>
  import("./shell/RunningIndicator.tsx").then((m) => ({ default: m.RunningIndicator })),
);
// The memory gauge shows a number only after its first read: loading it after the first screen moves nothing shown.
export const EngineUsageButton = lazy(() => import("./shell/EngineUsageButton.tsx"));
export const UsageButton = lazy(() => import("./shell/UsageButton.tsx").then((m) => ({ default: m.UsageButton })));

// The sidebar's extras: not needed for the first paint.
export const AppsDock = lazy(() => import("./shell/AppsDock.tsx").then((m) => ({ default: m.AppsDock })));
export const DesktopInstallNotice = lazy(() =>
  import("./shell/DesktopInstallNotice.tsx").then((m) => ({ default: m.DesktopInstallNotice })),
);

// The notices over the page with the full sidebar: none on most screens.
export const NoticeStrip = lazy(() => import("./shell/NoticeStrip.tsx").then((m) => ({ default: m.NoticeStrip })));

// The agent editor, opened from the super-agent's card in the top bar.
export const AgentEditor = lazy(
  withPacks(["team"], () => import("./project/team/AgentEditor.tsx").then((m) => ({ default: m.AgentEditor }))),
);

// Project dialogs, opened rarely.
export const NewProjectDialog = lazy(() =>
  import("./shell/NewProjectDialog.tsx").then((m) => ({ default: m.NewProjectDialog })),
);
export const UnregisterProjectDialog = lazy(() =>
  import("./shell/UnregisterProjectDialog.tsx").then((m) => ({ default: m.UnregisterProjectDialog })),
);
export const ProjectSettings = lazy(
  withPacks(["team"], () => import("./project/ProjectSettings.tsx").then((m) => ({ default: m.ProjectSettings }))),
);

export const JobList = lazy(() => import("./shell/JobList.tsx").then((m) => ({ default: m.JobList })));

export const CoreBehind = lazy(() => import("./shell/CoreBehind.tsx").then((m) => ({ default: m.CoreBehind })));
export const UpdateDialog = lazy(() => import("./shell/UpdateDialog.tsx").then((m) => ({ default: m.UpdateDialog })));
export const WhatsNewDialog = lazy(() =>
  import("./shell/WhatsNewDialog.tsx").then((m) => ({ default: m.WhatsNewDialog })),
);

// The side panel's tabs load when first opened, not with the chat.
export const ChatFiles = lazy(() => import("./panel/ChatFiles.tsx").then((m) => ({ default: m.ChatFiles })));
export const UsagePanel = lazy(() => import("./panel/UsagePanel.tsx").then((m) => ({ default: m.UsagePanel })));
export const ChangesPanel = lazy(() => import("./panel/ChangesPanel.tsx").then((m) => ({ default: m.ChangesPanel })));
export const AgentsPanel = lazy(() => import("./panel/AgentsPanel.tsx").then((m) => ({ default: m.AgentsPanel })));
export const ProcessesPanel = lazy(() =>
  import("./panel/ProcessesPanel.tsx").then((m) => ({ default: m.ProcessesPanel })),
);
export const TerminalPanel = lazy(() =>
  import("./panel/TerminalPanel.tsx").then((m) => ({ default: m.TerminalPanel })),
);
export const WidgetPanel = lazy(() => import("./panel/WidgetPanel.tsx").then((m) => ({ default: m.WidgetPanel })));
export const AgentPanel = lazy(
  withPacks(["team"], () => import("./panel/AgentPanel.tsx").then((m) => ({ default: m.AgentPanel }))),
);
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
export const ActivityView = lazy(() => import("./inbox/ActivityView.tsx").then((m) => ({ default: m.ActivityView })));
export const RoomPanel = lazy(() => import("./channels/RoomPanel.tsx").then((m) => ({ default: m.RoomPanel })));
export const ChannelFace = lazy(() => import("./inbox/ChannelFace.tsx").then((m) => ({ default: m.ChannelFace })));
export const ChannelTreeRow = lazy(() =>
  import("./inbox/ChannelTreeRow.tsx").then((m) => ({ default: m.ChannelTreeRow })),
);

// Message parts load with the first message that has one, not with the chat.
export const SurfacePart = lazy(() => import("./chat/parts/SurfacePart.tsx").then((m) => ({ default: m.SurfacePart })));
// A browser card shows only in a chat whose agent used a browser.
export const BrowserPart = lazy(() => import("./chat/parts/BrowserPart.tsx").then((m) => ({ default: m.BrowserPart })));
export const ChoicesPart = lazy(() => import("./chat/parts/ChoicesPart.tsx").then((m) => ({ default: m.ChoicesPart })));
export const ConnectPart = lazy(
  withPacks(["resources"], () => import("./chat/parts/ConnectPart.tsx").then((m) => ({ default: m.ConnectPart }))),
);
export const MediaGroup = lazy(() => import("./chat/parts/MediaGroup.tsx"));
export const InputPart = lazy(() => import("./chat/parts/InputPart.tsx").then((m) => ({ default: m.InputPart })));

export const AudioPlayer = lazy(() => import("./chat/parts/AudioPart.tsx").then((m) => ({ default: m.AudioPart })));

export const DelegationActions = lazy(() =>
  import("./chat/parts/DelegationActions.tsx").then((m) => ({ default: m.DelegationActions })),
);
export const GoOn = lazy(() => import("./chat/parts/GoOn.tsx").then((m) => ({ default: m.GoOn })));

// A file from the chat opened inside APX (a PDF, text).
export const FileViewer = lazy(() => import("./chat/parts/FileViewer.tsx").then((m) => ({ default: m.FileViewer })));

export const DocumentActions = lazy(() =>
  import("./panel/DocumentActions.tsx").then((m) => ({ default: m.DocumentActions })),
);

// The run button and its terminal load the first time a chat shows a shell block.
export const RunnableCode = lazy(() => import("./chat/RunnableCode.tsx").then((m) => ({ default: m.RunnableCode })));
// Any other code block's frame (copy, expand, an HTML page's preview) loads the first time a chat shows one; the
// Mermaid renderer, much larger, only when a block is a diagram.
export const CodeBlock = lazy(() => import("./chat/CodeBlock.tsx").then((m) => ({ default: m.CodeBlock })));
export const MermaidDiagram = lazy(() =>
  import("./chat/MermaidDiagram.tsx").then((m) => ({ default: m.MermaidDiagram })),
);
export const EmailCard = lazy(() => import("./chat/EmailCard.tsx").then((m) => ({ default: m.EmailCard })));
export const ReceivedDialog = lazy(() =>
  import("./chat/ReceivedDialog.tsx").then((m) => ({ default: m.ReceivedDialog })),
);

// A model picker's list shows only once it opens (the composer has a picker).
export const MoveSection = lazy(() => import("./config/MoveSection.tsx").then((m) => ({ default: m.MoveSection })));
export const ModelList = lazy(() => import("./config/models/ModelList.tsx").then((m) => ({ default: m.ModelList })));
export const ModelChoiceMenu = lazy(() =>
  import("./config/models/ModelChoiceMenu.tsx").then((m) => ({ default: m.ModelChoiceMenu })),
);

// The editor and its languages load when the first text file opens.
export const CodeView = lazy(() => import("./project/files/CodeView.tsx").then((m) => ({ default: m.CodeView })));

// Flows: the list first, then a flow's runs and the editor (with the canvas library) only when opened.
export const FlowsScreen = lazy(() => import("./flows/FlowsScreen.tsx"));
export const RoutinesScreen = lazy(() =>
  import("./routines/RoutinesScreen.tsx").then((m) => ({ default: m.RoutinesScreen })),
);
// A routine's runs as one chat, opened from the Inbox's routines.
export const RoutineChat = lazy(() => import("./routines/RoutineChat.tsx").then((m) => ({ default: m.RoutineChat })));
export const FlowDetail = lazy(() => import("./flows/FlowDetail.tsx").then((m) => ({ default: m.FlowDetail })));
export const FlowEditor = lazy(
  withPacks(["resources"], () => import("./flows/FlowEditor.tsx").then((m) => ({ default: m.FlowEditor }))),
);
// A project's tables, on the Flows screen's Tables.
export const TablesView = lazy(() => import("./flows/TablesView.tsx").then((m) => ({ default: m.TablesView })));
// A Flow an agent made or changed: its card in the chat draws it with the canvas library.
export const FlowCard = lazy(() => import("./flows/FlowCard.tsx").then((m) => ({ default: m.FlowCard })));
// Its drawing opened large, to look at each step.
export const FlowViewer = lazy(() => import("./flows/FlowViewer.tsx").then((m) => ({ default: m.FlowViewer })));

// The searchable picker (base-ui's combobox) loads after the first paint: the inbox's new-chat button has one.
export const SearchSelect = lazy(() =>
  import("./common/pickers/SearchSelect.tsx").then((m) => ({ default: m.SearchSelect })),
);

// "New agent" from the new-chat picker opens the same dialog as a team's.
export const NewAgentDialog = lazy(
  withPacks(["team"], () => import("./project/team/AgentDialogs.tsx").then((m) => ({ default: m.NewAgentDialog }))),
);

export const QrSvg = lazy(() => import("./common/QrSvg.tsx").then((m) => ({ default: m.QrSvg })));

// Plain modules loaded on first use.
export const loadOsNotices = () => import("./shell/osNotices.ts");
export const loadSounds = () => import("./shell/sounds.ts");
