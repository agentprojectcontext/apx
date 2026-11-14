import { render, waitFor } from "@testing-library/react-native";
import type { ApxClient, Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";
import { MediaClient } from "../src/ui/media/context";

jest.mock("../src/chat/mediaFiles", () => ({
  mediaFile: jest.fn(async (_client: unknown, item: { media_id: string }) => `file:///cache/${item.media_id}.jpg`),
}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));

const said = (id: string, name: string): Message =>
  ({
    id: `msg_${id}`,
    thread_id: "th_1",
    seq: 2,
    author: { kind: "person", id, name, channel: "whatsapp" },
    parts: [{ type: "text", text: "On my way" }],
    via: "whatsapp",
    created_at: "2026-10-21T15:00:00.000Z",
  }) as unknown as Message;

const coreWith = (pictures: Record<string, string>) => {
  const call = jest.fn(async (_method: string, input: { person: string }) => ({ media_id: pictures[input.person] }));
  return { client: { call } as unknown as ApxClient, call };
};

const shown = (ui: { toJSON: () => unknown }) => JSON.stringify(ui.toJSON());

test("a contact's message shows the picture they use on WhatsApp, not an agent's face", async () => {
  const { client, call } = coreWith({ per_northwind: "med_face" });
  const ui = await render(
    <MediaClient.Provider value={client}>
      <ChatMessage message={said("per_northwind", "Dana Northwind")} agents={[]} respond={async () => {}} />
    </MediaClient.Provider>,
  );
  expect(ui.getByLabelText("Dana Northwind")).toBeTruthy();
  await waitFor(() => expect(shown(ui)).toContain("file:///cache/med_face.jpg"));
  expect(call).toHaveBeenCalledWith("contacts.avatar", { person: "per_northwind" });
});

test("a contact who shows no picture keeps their initials", async () => {
  const { client, call } = coreWith({});
  const ui = await render(
    <MediaClient.Provider value={client}>
      <ChatMessage message={said("per_acme", "Ada Acme")} agents={[]} respond={async () => {}} />
    </MediaClient.Provider>,
  );
  await waitFor(() => expect(call).toHaveBeenCalledWith("contacts.avatar", { person: "per_acme" }));
  expect(ui.getByText("AA")).toBeTruthy();
});

test("someone in a group the owner never saved shows initials without asking for a picture", async () => {
  const { client, call } = coreWith({});
  const ui = await render(
    <MediaClient.Provider value={client}>
      <ChatMessage message={said("whatsapp:5550100@lid", "Sam Lee")} agents={[]} respond={async () => {}} />
    </MediaClient.Provider>,
  );
  expect(ui.getByText("SL")).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});
