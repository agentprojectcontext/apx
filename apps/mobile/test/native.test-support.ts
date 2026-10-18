// Hardware boundaries absent in Jest's process; app state and media decisions remain real.
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
