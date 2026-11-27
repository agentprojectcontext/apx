import { render } from "@testing-library/react-native";
import type { Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

const agents = [{ id: "agt_roby", name: "Roby" }] as never;

const cut = (code: "run.interrupted" | "run.resumed", text: string): Message =>
  ({
    id: `msg_${code}`,
    thread_id: "th_1",
    seq: 2,
    author: { kind: "agent", id: "agt_roby" },
    model: "acme/model-1",
    run_id: "run_1",
    parts: [{ type: "notice", level: "warn", code, text }],
    created_at: "2026-11-27T15:00:00.000Z",
  }) as unknown as Message;

const interrupted = cut("run.interrupted", "Interrupted by a restart of APX.");
const resumed = cut("run.resumed", "Interrupted by a restart of APX; picking it back up.");

test("a restart notice is a quiet system line: no agent name, no message actions", async () => {
  const ui = await render(<ChatMessage message={resumed} agents={agents} respond={async () => {}} />);
  expect(ui.getByText(/\S*(retomo|picking it back up)/)).toBeTruthy();
  expect(ui.queryByText(/Roby/)).toBeNull();
  expect(ui.queryByText(/acme\/model-1/)).toBeNull();
  expect(ui.queryByRole("button")).toBeNull();
});

test("a restart line that a later one repeats is not shown twice", async () => {
  const ui = await render(<ChatMessage message={resumed} agents={agents} respond={async () => {}} restartSuperseded />);
  expect(ui.queryByTestId("chat-message")).toBeNull();
  const later = await render(<ChatMessage message={interrupted} agents={agents} respond={async () => {}} />);
  expect(later.getByTestId("chat-message")).toBeTruthy();
});
