// Hardware boundaries absent in Jest's process; app state and media decisions remain real.
jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: () => false,
}));

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    currentTime: 0,
    playing: false,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
  })),
}));

jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    default: { ...actual.default, executionEnvironment: "standalone", appOwnership: "standalone" },
  };
});

// A WebView needs the native browser; tests read its props (the document, the bridge) on a plain view.
jest.mock("react-native-webview", () => {
  const { forwardRef, createElement } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return { WebView: forwardRef((props: object, ref: unknown) => createElement(View, { ...props, ref })) };
});

jest.mock("expo-screen-orientation", () => ({
  Orientation: { PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  OrientationLock: { PORTRAIT_UP: 3, LANDSCAPE: 5 },
  unlockAsync: jest.fn().mockResolvedValue(undefined),
  lockAsync: jest.fn().mockResolvedValue(undefined),
  getOrientationAsync: jest.fn().mockResolvedValue(1),
}));
