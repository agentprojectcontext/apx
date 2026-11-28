import { act, renderHook } from "@testing-library/react-native";
import { type FlatList, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type View } from "react-native";
import { answerOffset, useAnswerVisibility } from "../src/chat/answerVisibility";

test("an inverted transcript reveals the entire answer row without adding keyboard padding", () => {
  expect(answerOffset(100, 76, 410, 471, 38)).toBe(77);
  expect(answerOffset(100, 76, 410, 30, 38)).toBe(146);
  expect(answerOffset(100, 76, 410, 420, 38)).toBe(100);
  expect(answerOffset(0, 76, 410, 471, 38)).toBe(0);
  expect(answerOffset(100, 76, 100, 0, 176)).toBe(100);
});

test("focus and viewport resize reveal the answer; blur, drag and unmount stop automatic scrolling", async () => {
  let scheduled: FrameRequestCallback | undefined;
  const raf = jest.spyOn(global, "requestAnimationFrame").mockImplementation((callback) => {
    scheduled = callback;
    return 1;
  });
  const cancel = jest.spyOn(global, "cancelAnimationFrame").mockImplementation(() => {
    scheduled = undefined;
  });
  const subscription = Keyboard.addListener("keyboardDidShow", () => {});
  const remove = jest.spyOn(subscription, "remove");
  const keyboard = jest.spyOn(Keyboard, "addListener").mockReturnValue(subscription);
  const scrollToOffset = jest.fn();
  const list = { current: { scrollToOffset } as unknown as FlatList<unknown> };
  let viewportHeight = 690;
  const viewport = {
    measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) =>
      done(0, 76, 390, viewportHeight),
  } as unknown as View;
  const target = {
    measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) => done(30, 471, 260, 38),
  } as unknown as View;
  const flush = () => {
    const callback = scheduled;
    scheduled = undefined;
    callback?.(0);
  };
  try {
    const ui = await renderHook(() => useAnswerVisibility(list));
    ui.result.current.viewport.current = viewport;
    ui.result.current.onScroll({
      nativeEvent: { contentOffset: { y: 100 } },
    } as NativeSyntheticEvent<NativeScrollEvent>);
    await act(async () => {
      ui.result.current.focus.focus(target);
      flush();
    });
    expect(scrollToOffset).not.toHaveBeenCalled();
    viewportHeight = 410;
    await act(async () => {
      ui.result.current.reveal();
      flush();
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 77, animated: false });
    await act(async () => {
      ui.result.current.onScroll({
        nativeEvent: { contentOffset: { y: 358 } },
      } as NativeSyntheticEvent<NativeScrollEvent>);
      flush();
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 335, animated: false });
    scrollToOffset.mockClear();
    ui.result.current.onScrollBeginDrag();
    ui.result.current.onScroll({
      nativeEvent: { contentOffset: { y: 120 } },
    } as NativeSyntheticEvent<NativeScrollEvent>);
    expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => {
      ui.result.current.focus.blur(target);
      ui.result.current.reveal();
      flush();
    });
    expect(scrollToOffset).not.toHaveBeenCalled();
    ui.result.current.focus.focus(target);
    await ui.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(scheduled).toBeUndefined();
  } finally {
    raf.mockRestore();
    cancel.mockRestore();
    keyboard.mockRestore();
    subscription.remove();
  }
});
