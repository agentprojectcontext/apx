import { act, fireEvent, render } from "@testing-library/react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { t } from "../src/i18n";
import type { ApxClient, Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const message = (surface: string) =>
  ({
    id: "msg_w",
    thread_id: "th_1",
    seq: 1,
    author: { kind: "agent", id: "roby" },
    created_at: "2026-11-15T15:00:00.000Z",
    parts: [{ type: "surface", surface_id: surface, version: 1, title: "Sales by month" }],
  }) as unknown as Message;

const press = (node: Parameters<typeof fireEvent.press>[0]) => act(async () => fireEvent.press(node));
const bridgeNonce = (html: string) => /var N="([^"]+)"/.exec(html)?.[1] ?? "";

test("a widget an agent made shows live in the chat, as tall as its content, and opens full screen to turn", async () => {
  const call = jest.fn(async (method: string) => {
    if (method === "surfaces.get")
      return { id: "srf_1", title: "Sales by month", html: '<main class="apx-widget"><h1>Sales</h1></main>' };
    return {};
  });
  const client = { call } as unknown as ApxClient;
  const ui = await render(
    <ChatMessage message={message("srf_1")} agents={[]} client={client} respond={async () => {}} />,
  );
  await act(async () => {});
  expect(call).toHaveBeenCalledWith("surfaces.get", { surface: "srf_1" });
  const web = ui.getByTestId("surface-web");
  expect(web.props.source.html).toContain("<h1>Sales</h1>");
  // The page says how tall it is; the widget takes that room.
  await act(async () =>
    web.props.onMessage({
      nativeEvent: { data: JSON.stringify({ apx: bridgeNonce(web.props.source.html), kind: "size", h: 333 }) },
    }),
  );
  expect(JSON.stringify(ui.getByTestId("surface-web").props.style)).toContain('"height":333');
  await press(ui.getByLabelText(t("widgetFull")));
  expect(ScreenOrientation.unlockAsync).toHaveBeenCalled();
  await press(ui.getByLabelText(t("widgetTurn")));
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(ScreenOrientation.OrientationLock.LANDSCAPE);
  await press(ui.getByLabelText(t("close")));
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

test("a widget that is gone says so instead of a blank box", async () => {
  const client = { call: jest.fn(async () => Promise.reject(new Error("not found"))) } as unknown as ApxClient;
  const ui = await render(
    <ChatMessage message={message("srf_2")} agents={[]} client={client} respond={async () => {}} />,
  );
  await act(async () => {});
  expect(ui.getByText(t("widgetGone", { title: "Sales by month" }))).toBeTruthy();
});
