import { fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { AnswerVisibility } from "../src/chat/answerVisibility";
import { t } from "../src/i18n";
import { InputCard } from "../src/ui/chat/InputCard";

test("answer focus belongs to the transcript and a failed send retains its draft", async () => {
  const focus = { focus: jest.fn(), blur: jest.fn(), reveal: jest.fn() };
  const respond = jest.fn(async () => {
    throw new Error("Lab connection interrupted");
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    const ui = await render(
      <AnswerVisibility.Provider value={focus}>
        <InputCard
          part={{ type: "input", input_id: "details", kind: "question", state: "pending", prompt: "Which details?" }}
          respond={respond}
        />
      </AnswerVisibility.Provider>,
    );
    const input = ui.getByPlaceholderText(t("yourAnswer"));
    await fireEvent(input, "focus");
    expect(focus.focus).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(input, "First line\nSecond line");
    await fireEvent.press(ui.getByText(t("send")));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("details", { text: "First line\nSecond line" });
    expect(alert).toHaveBeenCalledWith(t("couldNotAnswer"), "Lab connection interrupted");
    expect(ui.getByDisplayValue("First line\nSecond line")).toBeTruthy();
    await fireEvent(input, "blur");
    expect(focus.blur).toHaveBeenCalled();
    await fireEvent.press(ui.getByText(t("send")));
    expect(respond).toHaveBeenCalledTimes(2);
  } finally {
    alert.mockRestore();
  }
});
