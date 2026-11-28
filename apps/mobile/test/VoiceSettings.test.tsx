import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { t } from "../src/i18n";
import { VoiceSettings } from "../src/ui/VoiceSettings";
import type { VoiceRead } from "../src/wakeWords";

// The phone's voice module, as on an Android build with wake by voice turned on.
jest.mock("../modules/apx-voice", () => ({
  hasNativeVoice: true,
  nativeVoice: { wake: () => true, canOverlay: () => true, setWake: jest.fn(), openOverlaySettings: jest.fn() },
}));

const usual = ["Ok Roby", "Che Roby", "Hey Roby"];
const loaded = (wake_words: string[], ready: boolean | undefined = true): VoiceRead => ({
  state: "loaded",
  wake_words,
  ready,
  preparing: false,
});

function mount(load: () => Promise<VoiceRead>, online = true) {
  const saveWords = jest.fn(async (words: string[]) => ({ wake_words: words.length ? words : usual }));
  const ui = render(<VoiceSettings name="Roby" load={load} saveWords={saveWords} online={online} />);
  return { ui, saveWords };
}

test("a failed read says APX's voice could not be read, and Retry reads it again", async () => {
  const load = jest
    .fn<Promise<VoiceRead>, []>()
    .mockResolvedValueOnce({ state: "unreachable" })
    .mockResolvedValue(loaded(usual));
  const { ui } = mount(load);
  const view = await ui;
  expect(await view.findByText(t("voiceUnreachable"))).toBeVisible();
  expect(view.queryByText(t("voiceWakeOff"))).toBeNull();
  await act(async () => fireEvent.press(view.getByRole("button", { name: t("retry") })));
  expect(await view.findByText("Ok Roby")).toBeVisible();
  expect(view.queryByText(t("voiceUnreachable"))).toBeNull();
  expect(view.getByText(t("voiceWakeHere"))).toBeVisible();
});

test("the screen reads again when the app comes back and when the core reconnects", async () => {
  const load = jest
    .fn<Promise<VoiceRead>, []>()
    .mockResolvedValueOnce({ state: "unreachable" })
    .mockResolvedValue(loaded(usual));
  const listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  const view = await mount(load).ui;
  expect(await view.findByText(t("voiceUnreachable"))).toBeVisible();
  await act(async () => {
    for (const listen of listeners) listen("active");
  });
  expect(await view.findByText("Che Roby")).toBeVisible();

  expect(view.queryByText(t("voiceUnreachable"))).toBeNull();

  const offline = jest.fn<Promise<VoiceRead>, []>().mockResolvedValue(loaded(["Hola Roby"]));
  const saveWords = jest.fn();
  const later = await render(<VoiceSettings name="Roby" load={offline} saveWords={saveWords} online={false} />);
  expect(offline).not.toHaveBeenCalled();
  expect(later.getByText(t("voiceUnreachable"))).toBeVisible();
  await later.rerender(<VoiceSettings name="Roby" load={offline} saveWords={saveWords} online />);
  expect(await later.findByText("Hola Roby")).toBeVisible();
});

test("phrases are chips: add with the field, remove with the x, and go back to the usual ones", async () => {
  const { ui, saveWords } = mount(async () => loaded(usual));
  const view = await ui;
  expect(await view.findByText(t("voicePhrasesUsual"))).toBeVisible();
  expect(view.queryByRole("button", { name: t("voicePhrasesReset") })).toBeNull();

  await act(async () => fireEvent.changeText(view.getByLabelText(t("voicePhraseNew")), "  Hola   Roby "));
  await act(async () => fireEvent(view.getByLabelText(t("voicePhraseNew")), "submitEditing"));
  expect(saveWords).toHaveBeenLastCalledWith([...usual, "Hola Roby"]);
  expect(await view.findByText("Hola Roby")).toBeVisible();
  expect(view.getByText(t("voicePhrasesShared"))).toBeVisible();

  await act(async () =>
    fireEvent.press(view.getByRole("button", { name: t("voicePhraseRemove", { phrase: "Ok Roby" }) })),
  );
  expect(saveWords).toHaveBeenLastCalledWith(["Che Roby", "Hey Roby", "Hola Roby"]);

  await act(async () => fireEvent.press(view.getByRole("button", { name: t("voicePhrasesReset") })));
  expect(saveWords).toHaveBeenLastCalledWith([]);
  await waitFor(() => expect(view.getByText("Ok Roby")).toBeVisible());
  expect(view.getByText(t("voicePhrasesUsual"))).toBeVisible();
});

test("calls not ready on the computer says so, and the phrases still show", async () => {
  const view = await mount(async () => loaded(usual, false)).ui;
  expect(await view.findByText(t("voiceWakeOff"))).toBeVisible();
  expect(view.getByText("Hey Roby")).toBeVisible();
});

test("a later failed read keeps the phrases it had and says it could not read them", async () => {
  const load = jest
    .fn<Promise<VoiceRead>, []>()
    .mockResolvedValueOnce(loaded(usual))
    .mockRejectedValue(new Error("socket closed"));
  const listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  const view = await mount(load).ui;
  expect(await view.findByText("Ok Roby")).toBeVisible();
  await act(async () => {
    for (const listen of listeners) listen("active");
  });
  expect(await view.findByText(t("voiceUnreachable"))).toBeVisible();
  expect(view.getByText("Ok Roby")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});
