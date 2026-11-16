import { render } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));

const answer = (text: string): Message =>
  ({
    id: "msg_1",
    thread_id: "home",
    seq: 3,
    author: { kind: "agent", id: "roby" },
    parts: [{ type: "text", text }],
    created_at: "2026-11-16T18:24:00.000Z",
  }) as unknown as Message;

test("an agent's SKIP shows as nothing new, never as the word", async () => {
  const ui = await render(<ChatMessage message={answer("**SKIP**")} agents={[]} respond={async () => {}} />);
  expect(ui.getByText(t("quietAnswer"))).toBeTruthy();
  expect(ui.queryByText(/SKIP/i)).toBeNull();
});

test("an answer that only mentions skipping still reads as written", async () => {
  const ui = await render(
    <ChatMessage message={answer("I'll skip the meeting.")} agents={[]} respond={async () => {}} />,
  );
  expect(ui.queryByText(t("quietAnswer"))).toBeNull();
});
