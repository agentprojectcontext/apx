// What computer use needs from the operating system, one driver per platform (computer-mac.ts, computer-win.ts).
// Every position is in screen points, as Electron's screen module counts them.

export type Bounds = { x: number; y: number; width: number; height: number };

/** The window in front: its app, process, name and bounds, and (when asked) its elements as text lines. */
export type Front = { app: string; pid: number; window: string; bounds: Bounds | undefined; lines: string[] };

export type ComputerDriver = {
  front(withElements: boolean): Promise<Front>;
  /** Brings an app forward, when it is not there already. */
  activate(app: string): Promise<void>;
  /** Whose normal window is really on top at a point, or undefined for none. */
  topAt(x: number, y: number): Promise<{ pid: number; name: string } | undefined>;
  /** Opens an app (with a URL in it), or a URL in the default browser. */
  open(app: string | undefined, url: string | undefined): Promise<void>;
  canPress(keys: string): boolean;
  /** Presses keys in the app in front; resolves to the app's name. */
  key(app: string, keys: string): Promise<string>;
  /** Presses or focuses the element at a point without the pointer: "pressed …", "focused …" or "none: why". */
  press(app: string, x: number, y: number): Promise<string>;
  /** A real click at a point, putting the owner's pointer back; refused when another window covers it. */
  click(app: string, x: number, y: number): Promise<void>;
  /** Inserts text into the app's focused field in place (in front or not); false when that field does not take it. */
  insert(app: string, text: string): Promise<boolean>;
  /** Types text into the app in front, the way a person would. */
  paste(app: string, text: string): Promise<void>;
};
