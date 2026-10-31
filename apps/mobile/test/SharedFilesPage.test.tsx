import { act, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { type SharedActions, SharedFilesPage } from "../src/pages/SharedFilesPage";
import type { ApxClient, SharedFile } from "../src/protocol";
import { MediaClient } from "../src/ui/media/context";

// Pictures come from the phone's media cache, and videos play in expo-video: neither runs under jest.
jest.mock("../src/chat/mediaFiles", () => ({
  mediaFile: jest.fn(async () => "file:///cache/picture.jpg"),
  saveMedia: jest.fn(),
  shareMedia: jest.fn(),
}));
jest.mock("expo-video", () => ({ useVideoPlayer: () => ({ play: () => {} }), VideoView: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const data = {
  ...emptyWorkspace,
  owner: "Sam",
  projects: [{ id: "p_acme", name: "Acme", path: "/work/acme", registered: true }],
  agents: [{ id: "roby", name: "Roby" }],
};
const shared = (over: Partial<SharedFile>): SharedFile => ({
  media_id: "med_photo",
  kind: "image",
  mime: "image/jpeg",
  name: "storefront.jpg",
  bytes: 2048,
  path: "/kept/storefront.jpg",
  thread_id: "th_launch",
  thread_title: "Storefront launch",
  project_id: "p_acme",
  message_id: "msg_photo",
  author: { kind: "user" },
  created_at: "2026-01-01T09:00:00.000Z",
  ...over,
});
const photo = shared({});
const clip = shared({
  media_id: "med_clip",
  kind: "video",
  mime: "video/mp4",
  name: "teaser.mp4",
  message_id: "msg_clip",
  author: { kind: "agent", id: "roby" },
});
const actions = (): SharedActions & { list: jest.Mock; poster: jest.Mock } => ({
  list: jest.fn(async ({ kind }) => ({
    items: kind === "video" ? [clip] : [clip, photo],
    more: false,
    counts: { image: 1, video: 1, audio: 0, document: 0 },
  })),
  poster: jest.fn(async () => "anBn"),
});
const mount = (api: SharedActions, openMessage = jest.fn()) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <MediaClient.Provider value={{} as ApxClient}>
        <SharedFilesPage data={data} back={jest.fn()} actions={api} openMessage={openMessage} />
      </MediaClient.Provider>
    </SafeAreaProvider>,
  );

test("shared files show as cards with their chat and sender, and each kind's count filters them", async () => {
  const api = actions();
  const ui = await mount(api);
  expect(ui.getByRole("button", { name: "storefront.jpg" })).toBeVisible();
  expect(ui.getByRole("button", { name: "teaser.mp4" })).toBeVisible();
  expect(ui.getAllByText("Acme · Storefront launch")).toHaveLength(2);
  expect(ui.getByText("Roby")).toBeVisible();
  expect(api.poster).toHaveBeenCalledWith("med_clip");
  await fireEvent.press(ui.getByText(`${t("sharedVideos")} 1`));
  expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "video", offset: 0 }));
  expect(ui.queryByRole("button", { name: "storefront.jpg" })).toBeNull();
  await ui.unmount();
});

test("the search asks the core by name once typing pauses", async () => {
  jest.useFakeTimers();
  try {
    const api = actions();
    const ui = await mount(api);
    await fireEvent.changeText(ui.getByPlaceholderText(t("sharedSearch")), "store");
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: "store" }));
    await ui.unmount();
  } finally {
    jest.useRealTimers();
  }
});

test("a card opens full screen, and Go to chat leads to the message it was sent in", async () => {
  const openMessage = jest.fn();
  const ui = await mount(actions(), openMessage);
  await fireEvent.press(ui.getByRole("button", { name: "storefront.jpg" }));
  expect(ui.getByRole("button", { name: t("close") })).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("sharedGoToChat") }));
  expect(openMessage).toHaveBeenCalledWith("th_launch", "msg_photo");
  expect(ui.queryByRole("button", { name: t("sharedGoToChat") })).toBeNull();
  await ui.unmount();
});
