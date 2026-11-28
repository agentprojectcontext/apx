import { act, renderHook } from "@testing-library/react-native";
import { type FlatList, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type View } from "react-native";
import { useAnswerVisibility } from "../src/chat/answerVisibility";

test("caret scrolling discards superseded measurements and waits for the reported native offset", async () => {
  let scheduled: FrameRequestCallback | undefined;
  const raf = jest.spyOn(global, "requestAnimationFrame").mockImplementation((callback) => {
    scheduled = callback;
    return 1;
  });
  const cancel = jest.spyOn(global, "cancelAnimationFrame").mockImplementation(() => {
    scheduled = undefined;
  });
  const subscription = Keyboard.addListener("keyboardDidShow", () => {});
  const keyboard = jest.spyOn(Keyboard, "addListener").mockReturnValue(subscription);
  type Measured = (x: number, y: number, width: number, height: number) => void;
  const viewports: Measured[] = [];
  const targets: Measured[] = [];
  const scrollToOffset = jest.fn();
  const list = { current: { scrollToOffset } as unknown as FlatList<unknown> };
  const viewport = { measureInWindow: (done: Measured) => viewports.push(done) } as unknown as View;
  const target = { measureInWindow: (done: Measured) => targets.push(done) } as unknown as View;
  const frame = () => {
    const callback = scheduled;
    scheduled = undefined;
    callback?.(0);
  };
  const frames = () => {
    while (scheduled) frame();
  };
  const scroll = (y: number) => ({ nativeEvent: { contentOffset: { y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
  const ui = await renderHook(() => useAnswerVisibility(list));
  try {
    ui.result.current.viewport.current = viewport;
    await act(async () => {
      ui.result.current.focus.focus(target);
      frame();
    });
    expect(viewports).toHaveLength(0);
    await act(async () => frame());
    expect(viewports).toHaveLength(1);
    await act(async () => {
      ui.result.current.onScroll(scroll(358));
      viewports[0]?.(0, 88.5, 320, 190);
      frames();
    });
    expect(targets).toHaveLength(0);
    await act(async () => viewports[1]?.(0, 88.5, 320, 190));
    expect(targets).toHaveLength(1);
    await act(async () => {
      ui.result.current.onScroll(scroll(493));
      targets[0]?.(0, 635.5, 260, 68);
      frames();
    });
    expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => {
      viewports[2]?.(0, 88.5, 320, 190);
      targets[1]?.(0, 635.5, 260, 68);
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 68, animated: false });
    await act(async () => {
      ui.result.current.reveal();
      frames();
      viewports[3]?.(0, 88.5, 320, 190);
      targets[2]?.(0, 635.5, 260, 68);
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 68, animated: false });
  } finally {
    await ui.unmount();
    raf.mockRestore();
    cancel.mockRestore();
    keyboard.mockRestore();
    subscription.remove();
  }
});
