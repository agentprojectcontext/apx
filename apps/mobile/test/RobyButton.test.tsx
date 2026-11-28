import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Agent, Thread } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import type { ApxClient } from "../src/protocol";
import { RobyButton } from "../src/roby/RobyButton";

const mockRecorder = {
  uri: "file:///note.m4a",
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(),
  stop: jest.fn(async () => {}),
};
jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({ durationMillis: 3000 }),
}));
jest.mock("expo-file-system", () => ({
  File: class {
    async base64() {
      return "AAAA";
    }
  },
}));

const agent = { id: "boss", name: "Roby", kind: "secretary" } as Agent;
const home = { id: "home", kind: "loose", state: "idle", agent_ids: ["boss"] } as Thread;

async function mount(mode: "call" | "record", target: Thread | null = home) {
  const call = jest.fn();
  const make = jest.fn(async () => ({ ...home, id: "made" }));
  const client = {
    call: jest.fn(async (method: string) => {
      if (method === "media.upload") return { media: { id: "audio_1" } };
      if (method === "media.transcribe") return { text: " buy bread " };
      return {};
    }),
  };
  const ui = await render(
    <RobyButton
      agent={agent}
      mode={mode}
      client={client as unknown as ApxClient}
      target={() => target ?? undefined}
      make={make}
      call={call}
    />,
  );
  return { ui, call, make, client };
}

const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });
const clock = (ms: number) => jest.spyOn(Date, "now").mockReturnValue(ms);

test("with calls ready a tap calls the super-agent, by its own name", async () => {
  const { ui, call, client } = await mount("call");
  const button = await ui.findByRole("button", { name: t("voiceCall", { name: "Roby" }) });
  expect(ui.getByText("Roby")).toBeVisible();
  await act(async () => {
    fireEvent(button, "responderGrant", at(0, 0));
    fireEvent(button, "responderRelease", at(0, 0));
  });
  expect(call).toHaveBeenCalledTimes(1);
  expect(client.call).not.toHaveBeenCalled();
});

test("holding records a note and letting go sends it to the chosen chat with what was heard", async () => {
  const { ui, client } = await mount("record");
  const button = await ui.findByRole("button", { name: t("robyHold", { name: "Roby" }) });
  clock(1_000);
  await act(async () => fireEvent(button, "responderGrant", at(10, 10)));
  await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
  expect(ui.getByText(`0:03 · ${t("robySlideCancel")}`)).toBeVisible();
  clock(3_000);
  await act(async () => fireEvent(button, "responderRelease", at(12, 14)));
  await waitFor(() =>
    expect(client.call).toHaveBeenCalledWith("threads.send", {
      thread: "home",
      text: "buy bread",
      attachments: ["audio_1"],
      mode: "queue",
    }),
  );
  expect(client.call).toHaveBeenCalledWith("media.upload", expect.objectContaining({ thread: "home" }));
});

test("with no chat to send to, the note makes one", async () => {
  const { ui, client, make } = await mount("record", null);
  const button = await ui.findByRole("button", { name: t("robyHold", { name: "Roby" }) });
  clock(1_000);
  await act(async () => fireEvent(button, "responderGrant", at(0, 0)));
  await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
  clock(4_000);
  await act(async () => fireEvent(button, "responderRelease", at(0, 0)));
  await waitFor(() => expect(make).toHaveBeenCalled());
  await waitFor(() =>
    expect(client.call).toHaveBeenCalledWith("threads.send", expect.objectContaining({ thread: "made" })),
  );
});

test("sliding away drops the note, and a quick tap only says to hold", async () => {
  const { ui, client } = await mount("record");
  const button = await ui.findByRole("button", { name: t("robyHold", { name: "Roby" }) });
  clock(1_000);
  await act(async () => fireEvent(button, "responderGrant", at(0, 0)));
  await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
  await act(async () => fireEvent(button, "responderMove", at(0, -200)));
  expect(ui.getByText(t("robyReleaseCancel"))).toBeVisible();
  clock(5_000);
  await act(async () => fireEvent(button, "responderRelease", at(0, -200)));
  await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalled());
  expect(client.call).not.toHaveBeenCalled();

  clock(10_000);
  await act(async () => fireEvent(button, "responderGrant", at(0, 0)));
  await waitFor(() => expect(ui.getByText(`0:03 · ${t("robySlideCancel")}`)).toBeVisible());
  clock(10_100);
  await act(async () => fireEvent(button, "responderRelease", at(0, 0)));
  await waitFor(() => expect(ui.queryByText(`0:03 · ${t("robySlideCancel")}`)).toBeNull());
  expect(client.call).not.toHaveBeenCalled();
});
