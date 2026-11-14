import { act, fireEvent, render } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { ApxClient, Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const message = (text: string) =>
  ({
    id: "msg_1",
    thread_id: "th_1",
    seq: 1,
    author: { kind: "agent", id: "roby" },
    created_at: "2026-11-13T15:00:00.000Z",
    parts: [{ type: "text", text }],
  }) as unknown as Message;

const client = { call: jest.fn(async () => ({})) } as unknown as ApxClient;
const fence = (lang: string, value: unknown) => `Two ideas.\n\n\`\`\`${lang}\n${JSON.stringify(value)}\n\`\`\``;
const show = (text: string) =>
  render(<ChatMessage message={message(text)} agents={[]} client={client} respond={async () => {}} />);

test("an agent's results show as cards on the phone, and their details open", async () => {
  const ui = await show(
    fence("apx-cards", {
      title: "Movie ideas",
      example: true,
      fallback: "The quiet moon and Northbound.",
      items: [
        {
          id: "moon",
          eyebrow: "Movie · 2024",
          title: "The quiet moon",
          badges: ["Drama"],
          fields: [{ label: "Length", value: "108 min" }],
          details: "An invented journey to the moon.",
        },
        { id: "north", title: "Northbound" },
      ],
    }),
  );
  expect(ui.getByText("Movie ideas")).toBeTruthy();
  expect(ui.getByText(t("inlineExample"))).toBeTruthy();
  expect(ui.getByText("Movie · 2024")).toBeTruthy();
  expect(ui.getByText("108 min")).toBeTruthy();
  expect(ui.getByText("Northbound")).toBeTruthy();
  expect(ui.queryByText("An invented journey to the moon.")).toBeNull();
  await act(async () => fireEvent.press(ui.getByText(t("inlineDetails"))));
  expect(ui.getByText("An invented journey to the moon.")).toBeTruthy();
  expect(ui.queryByText(/"items"/)).toBeNull();
});

test("an A2UI block the phone cannot draw shows its fallback text, not its code", async () => {
  const ui = await show(
    fence("a2ui", {
      fallback: "Buy it from the store's page.",
      messages: [
        {
          version: "1.0",
          createSurface: {
            surfaceId: "b",
            catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
          },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "b",
            components: [{ id: "root", component: "Button", child: "x", action: { event: { name: "buy" } } }],
          },
        },
      ],
    }),
  );
  expect(ui.getByText("Buy it from the store's page.")).toBeTruthy();
  expect(ui.queryByText(/createSurface/)).toBeNull();
});
