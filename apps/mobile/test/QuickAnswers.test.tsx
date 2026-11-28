import { act, fireEvent, render } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { InputCard } from "../src/ui/chat/InputCard";

type Input = Extract<Message["parts"][number], { type: "input" }>;
const question: Input = {
  type: "input",
  input_id: "ready",
  kind: "question",
  state: "pending",
  prompt: "¿Ya está desbloqueado el dispositivo de laboratorio?",
  options: ["Ya está", "Todavía no"],
};

test("a readiness option sends once without a second submit and never approves an action", async () => {
  let finish: (() => void) | undefined;
  const respond = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const ui = await render(<InputCard part={question} respond={respond} />);
  expect(respond).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByText("Ya está"));
  expect(respond).toHaveBeenCalledWith("ready", { text: "Ya está" });
  await fireEvent.press(ui.getByText("Todavía no"));
  expect(respond).toHaveBeenCalledTimes(1);
  await act(async () => finish?.());
});

test("open questions have no invented answers and keep free text and skip", async () => {
  const respond = jest.fn(async () => {});
  const ui = await render(
    <InputCard part={{ ...question, prompt: "Which color?", options: undefined }} respond={respond} />,
  );
  expect(ui.queryByText("Ya está")).toBeNull();
  await fireEvent.changeText(ui.getByPlaceholderText(t("yourAnswer")), "Blue, please");
  await fireEvent.press(ui.getByText(t("send")));
  expect(respond).toHaveBeenCalledWith("ready", { text: "Blue, please" });
  await fireEvent.press(ui.getByText(t("inputSkip")));
  expect(respond).toHaveBeenLastCalledWith("ready", { text: t("inputSkipped") });
});

test("multiple choices wait for submit and preserve their provided order", async () => {
  const respond = jest.fn(async () => {});
  const ui = await render(<InputCard part={{ ...question, multi: true }} respond={respond} />);
  await fireEvent.press(ui.getByText("Todavía no"));
  await fireEvent.press(ui.getByText("Ya está"));
  expect(respond).not.toHaveBeenCalled();
  const send = ui.getAllByText(t("send"));
  const selected = send[0];
  if (!selected) throw new Error("missing selected answer submit");
  await fireEvent.press(selected);
  expect(respond).toHaveBeenCalledWith("ready", { text: "Ya está, Todavía no" });
});

test("action confirmations remain accept/decline, not readiness answers", async () => {
  const respond = jest.fn(async () => {});
  const ui = await render(
    <InputCard
      part={{ ...question, kind: "confirm", prompt: "Publish this draft?", options: undefined }}
      respond={respond}
    />,
  );
  expect(ui.queryByText("Ya está")).toBeNull();
  expect(ui.queryByPlaceholderText(t("yourAnswer"))).toBeNull();
  expect(respond).not.toHaveBeenCalled();
});
