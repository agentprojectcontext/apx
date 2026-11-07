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

const DRAFT =
  "Here it is:\n\n```email\nTo: team@example.com\nSubject: Pre-approval inquiry\n\nHello team,\nCould you confirm?\n```";

const message = (author: Message["author"], text: string) =>
  ({
    id: "msg_1",
    thread_id: "th_1",
    seq: 1,
    author,
    created_at: "2026-10-21T15:00:00.000Z",
    parts: [{ type: "text", text }],
  }) as unknown as Message;

/** A client whose mail routes are `routes`, recording what is sent. */
function fakeClient(routes: Array<{ kind: string; id: string; label: string; address?: string }>) {
  const sent: unknown[] = [];
  const call = jest.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "mail.routes") return { routes, sent: [] };
    if (method === "mail.send") {
      sent.push(params);
      return { key: params.key, at: "2026-10-21T15:00:05.000Z", via: "user@example.com" };
    }
    throw new Error(method);
  });
  return { client: { call } as unknown as ApxClient, sent };
}

const agent = { kind: "agent", id: "roby" } as Message["author"];

beforeEach(() => jest.useFakeTimers());
/** The countdown ticks once a second, each tick after the card shows the last one. */
const seconds = async (n: number) => {
  for (let i = 0; i < n; i++) await act(async () => jest.advanceTimersByTime(1000));
};
afterEach(() => jest.useRealTimers());

test("an agent's email draft is a card the owner sends from their Gmail, with seconds to undo", async () => {
  const { client, sent } = fakeClient([{ kind: "gmail", id: "gmail", label: "Gmail", address: "user@example.com" }]);
  const ui = await render(
    <ChatMessage message={message(agent, DRAFT)} agents={[]} client={client} respond={async () => {}} />,
  );
  expect(ui.getByText("Pre-approval inquiry")).toBeTruthy();
  expect(ui.getByText("team@example.com")).toBeTruthy();
  await act(async () => fireEvent.press(await ui.findByText(t("mailSend"))));
  expect(await ui.findByText(t("mailSendingIn", { n: 5 }))).toBeTruthy();
  await act(async () => fireEvent.press(ui.getByText(t("mailUndo"))));
  await seconds(6);
  expect(sent).toEqual([]);

  await act(async () => fireEvent.press(await ui.findByText(t("mailSend"))));
  await seconds(6);
  expect(sent).toEqual([
    expect.objectContaining({
      route: { kind: "gmail", id: "gmail" },
      to: ["team@example.com"],
      subject: "Pre-approval inquiry",
      body: "Hello team,\nCould you confirm?",
    }),
  ]);
  expect(await ui.findByText(t("mailSent", { from: "user@example.com" }))).toBeTruthy();
});

test("with nothing connected the draft only opens in a mail app; a mail on the email channel shows as a card", async () => {
  const { client } = fakeClient([]);
  const ui = await render(
    <ChatMessage message={message(agent, DRAFT)} agents={[]} client={client} respond={async () => {}} />,
  );
  expect(await ui.findByText(t("mailOpen"))).toBeTruthy();
  expect(ui.queryByText(t("mailSend"))).toBeNull();

  const received = await render(
    <ChatMessage
      message={message({ kind: "person", id: "p1", name: "Northwind", channel: "email" }, "[subject: Invoice]\nPaid.")}
      agents={[]}
      mailChannels={new Set(["email"])}
      respond={async () => {}}
    />,
  );
  expect(received.getByText("Invoice")).toBeTruthy();
  expect(received.getByText("Northwind")).toBeTruthy();
  expect(received.getByText("Paid.")).toBeTruthy();
});
