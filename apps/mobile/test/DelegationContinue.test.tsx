import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

// The message's media code plays and saves files on the phone; nothing here shows media.
jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const notice = (variant: string): Message =>
  ({
    id: `msg_${variant}`,
    thread_id: "home",
    seq: 1,
    author: { kind: "system" },
    created_at: "2026-10-21T15:00:00.000Z",
    parts: [
      {
        type: "notice",
        level: "warn",
        code: "delegation.limit",
        text: "Cody ran out of steps",
        vars: {
          variant,
          who: "Cody",
          task: "Pricing",
          session: "cody-4",
          caller: "Roby",
          sofar: "",
          subthread: "th_sub",
        },
      },
    ],
  }) as unknown as Message;

test("a delegated session APX stopped offers Continue on the phone, which goes on with that session", async () => {
  const continueSession = jest.fn(async () => undefined);
  const ui = await render(
    <ChatMessage
      message={notice("stoppedSteps")}
      agents={[]}
      respond={async () => {}}
      continueSession={continueSession}
    />,
  );
  await fireEvent.press(ui.getByText(t("delegationContinue")));
  await waitFor(() => expect(ui.getByText(t("delegationWentOn"))).toBeVisible());
  expect(continueSession).toHaveBeenCalledWith("th_sub");
});

test("a session APX is already going on with has nothing to press", async () => {
  const ui = await render(
    <ChatMessage message={notice("continuedSteps")} agents={[]} respond={async () => {}} continueSession={jest.fn()} />,
  );
  expect(ui.queryByText(t("delegationContinue"))).toBeNull();
});
