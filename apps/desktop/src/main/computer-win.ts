// Computer use on Windows: one PowerShell kept open for the session runs a small C# helper (UI Automation for a
// window's elements and presses, SendInput for real clicks and keys). Requests and answers travel one per line,
// base64-encoded, so no value is ever read as code. The helper counts physical pixels; Electron's screen module turns
// them into the screen points the rest of computer use speaks.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app as electronApp, screen } from "electron";
import type { Bounds, ComputerDriver, Front } from "./computer-driver.ts";
import { parseWinKeys } from "./keys.ts";

const CALL_MS = 15_000;
/** Reading every element of a window, within the core's deadline for a look (the picture still has to follow). */
const ELEMENTS_MS = 4_000;

/** Programs that run what they are given: never opened by an agent, whatever URL comes with them. */
const REFUSED_APPS =
  /^(cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|regedit|bash|wsl|sh|python\d*|py|node|msiexec|schtasks|reg|wt|windowsterminal|conhost|taskmgr|control|mmc)(\.exe)?$/i;
/** The names people (and agents used to macOS) give apps, and the program Windows knows them by. */
const ALIASES: Record<string, string> = {
  "google chrome": "chrome.exe",
  chrome: "chrome.exe",
  "microsoft edge": "msedge.exe",
  edge: "msedge.exe",
  "brave browser": "brave.exe",
  brave: "brave.exe",
  firefox: "firefox.exe",
  "mozilla firefox": "firefox.exe",
  finder: "explorer.exe",
  "file explorer": "explorer.exe",
  explorer: "explorer.exe",
  textedit: "notepad.exe",
  notepad: "notepad.exe",
  calculator: "calc.exe",
};

const HELPER = String.raw`
$ErrorActionPreference = "Stop"
$refs = @("UIAutomationClient", "UIAutomationTypes", "WindowsBase") | ForEach-Object {
  [System.Reflection.Assembly]::LoadWithPartialName($_).Location
}
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;

public static class ApxWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint size; public uint time; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmRect(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h, int a, out int v, int size);

  public static void Init() {
    // Per-monitor aware: every position is the screen's own pixels, on every monitor.
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  static string Clean(string s, int max) {
    if (s == null) return "";
    s = s.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Trim();
    return s.Length > max ? s.Substring(0, max) : s;
  }
  static string Norm(string s) {
    s = (s ?? "").ToLowerInvariant();
    if (s.EndsWith(".exe")) s = s.Substring(0, s.Length - 4);
    StringBuilder b = new StringBuilder();
    foreach (char c in s) if (char.IsLetterOrDigit(c)) b.Append(c);
    return b.ToString();
  }
  static Process Proc(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { return Process.GetProcessById((int)pid); } catch { return null; }
  }
  /** The app's own name ("Brave Browser"), or its process name when it has none to give. */
  static string Describe(Process p) {
    if (p == null) return "";
    try {
      string d = p.MainModule.FileVersionInfo.FileDescription;
      if (!string.IsNullOrEmpty(d) && d.Trim().Length <= 40) return d.Trim();
    } catch { }
    return p.ProcessName;
  }
  /** "Brave", "Brave Browser" and "brave.exe" all name brave.exe; "Edge" names msedge.exe. */
  static bool Matches(Process p, string want) {
    if (p == null) return false;
    string w = Norm(want), n = Norm(p.ProcessName);
    if (w.Length == 0) return false;
    if (n == w) return true;
    string d = Norm(Describe(p));
    if (d == w) return true;
    if (n.Length >= 3 && w.Contains(n)) return true;
    return w.Length >= 4 && (d.Contains(w) || n.Contains(w));
  }
  static RECT Rect(IntPtr h) {
    RECT r;
    if (DwmRect(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
  static string Title(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return Clean(s.ToString(), 200); }
  /** A window a person works in: shown, not cloaked on another desktop, not a tool palette, of a real size. */
  static bool Normal(IntPtr h, bool minimizedToo) {
    if (!IsWindowVisible(h)) return false;
    if (IsIconic(h)) { if (!minimizedToo) return false; }
    else { RECT r = Rect(h); if (r.R - r.L < 300 || r.B - r.T < 200) return false; }
    int cloaked; if (DwmInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    long ex = GetWindowLongPtr(h, -20).ToInt64();
    return (ex & 0x80) == 0 && Title(h).Length > 0;
  }
  /** The app's frontmost normal window, in the screen's order. */
  static IntPtr MainWindow(string app) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (Normal(h, true) && Matches(Proc(h), app)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  static Process FrontProc(string app) {
    Process p = Proc(GetForegroundWindow());
    if (!Matches(p, app)) throw new Exception(app + " is not in front (" + Describe(p) + " is): nothing was done, take a new screen_snapshot");
    return p;
  }

  public static string Front(bool withElements, int budget) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) throw new Exception("no window is in front");
    // A small popup in front of an app (a menu, a palette): its owner's main window.
    if (!Normal(h, false)) { IntPtr owner = GetAncestor(h, 3); if (owner != IntPtr.Zero && Normal(owner, false)) h = owner; }
    Process p = Proc(h);
    RECT r = Rect(h);
    StringBuilder o = new StringBuilder();
    o.Append(Describe(p)).Append('\t').Append(p == null ? 0 : p.Id).Append('\n');
    o.Append(Title(h)).Append('\n');
    o.Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R - r.L).Append(',').Append(r.B - r.T).Append('\n');
    if (withElements) {
      IntPtr target = h;
      Task<string> t = Task.Run(delegate { return Elements(target); });
      if (!t.Wait(budget)) throw new Exception("timed out");
      o.Append(t.Result);
    }
    return o.ToString();
  }

  static readonly ControlType[] Wanted = {
    ControlType.Button, ControlType.CheckBox, ControlType.RadioButton, ControlType.Edit, ControlType.ComboBox,
    ControlType.Hyperlink, ControlType.TabItem, ControlType.ListItem, ControlType.MenuItem, ControlType.Slider,
    ControlType.SplitButton, ControlType.TreeItem, ControlType.DataItem, ControlType.Text, ControlType.Document
  };
  static string Role(ControlType t) { return t.ProgrammaticName.Replace("ControlType.", ""); }

  static string Elements(IntPtr h) {
    AutomationElement root = AutomationElement.FromHandle(h);
    CacheRequest cr = new CacheRequest();
    cr.Add(AutomationElement.NameProperty);
    cr.Add(AutomationElement.ControlTypeProperty);
    cr.Add(AutomationElement.BoundingRectangleProperty);
    cr.Add(AutomationElement.IsOffscreenProperty);
    cr.Add(AutomationElement.HelpTextProperty);
    cr.Add(ValuePattern.ValueProperty);
    cr.AutomationElementMode = AutomationElementMode.None;
    List<Condition> any = new List<Condition>();
    foreach (ControlType t in Wanted) any.Add(new PropertyCondition(AutomationElement.ControlTypeProperty, t));
    StringBuilder o = new StringBuilder();
    using (cr.Activate()) {
      AutomationElementCollection all = root.FindAll(TreeScope.Descendants, new OrCondition(any.ToArray()));
      int n = 0;
      foreach (AutomationElement e in all) {
        if (n >= 400) break;
        try {
          if ((bool)e.GetCachedPropertyValue(AutomationElement.IsOffscreenProperty)) continue;
          System.Windows.Rect b = (System.Windows.Rect)e.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty);
          if (b.IsEmpty || b.Width < 1 || b.Height < 1) continue;
          object v = e.GetCachedPropertyValue(ValuePattern.ValueProperty, true);
          string value = v == AutomationElement.NotSupported || v == null ? "" : v.ToString();
          ControlType ct = (ControlType)e.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
          o.Append(Role(ct)).Append('\t')
            .Append(Clean((string)e.GetCachedPropertyValue(AutomationElement.NameProperty), 80)).Append('\t')
            .Append(Clean((string)e.GetCachedPropertyValue(AutomationElement.HelpTextProperty), 80)).Append('\t')
            .Append(Clean(value, 80)).Append('\t')
            .Append((int)(b.X + b.Width / 2)).Append(',').Append((int)(b.Y + b.Height / 2)).Append('\n');
          n++;
        } catch { }
      }
    }
    return o.ToString();
  }

  public static string TopAt(int x, int y) {
    POINT pt; pt.X = x; pt.Y = y;
    IntPtr h = GetAncestor(WindowFromPoint(pt), 2);
    if (h == IntPtr.Zero) return "";
    Process p = Proc(h);
    return p == null ? "" : p.Id + "\t" + Describe(p);
  }

  static bool InFront(string app) { return Matches(Proc(GetForegroundWindow()), app); }

  public static string Activate(string app) {
    IntPtr h = MainWindow(app);
    if (h == IntPtr.Zero) throw new Exception(app + " is not open: open it with screen_open");
    if (InFront(app)) return "";
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows lets the process behind the last input bring a window forward: an empty one first.
    INPUT[] nudge = new INPUT[1];
    nudge[0].type = 0;
    SendInput(1, nudge, Marshal.SizeOf(typeof(INPUT)));
    SetForegroundWindow(h);
    Thread.Sleep(150);
    if (!InFront(app)) {
      // Joined to the thread in front, a window may take the foreground from it.
      uint ignored;
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out ignored), me = GetCurrentThreadId();
      AttachThreadInput(me, fg, true);
      BringWindowToTop(h);
      SetForegroundWindow(h);
      AttachThreadInput(me, fg, false);
      Thread.Sleep(150);
    }
    if (!InFront(app)) {
      // Minimized and restored, a window always comes up in front.
      ShowWindow(h, 6);
      ShowWindow(h, 9);
      Thread.Sleep(300);
    }
    if (!InFront(app)) throw new Exception("could not bring " + app + " forward (" + Describe(Proc(GetForegroundWindow())) + " is in front)");
    return "";
  }

  static readonly ControlType[] Pressable = {
    ControlType.Button, ControlType.Hyperlink, ControlType.CheckBox, ControlType.RadioButton, ControlType.MenuItem,
    ControlType.TabItem, ControlType.ListItem, ControlType.TreeItem, ControlType.SplitButton, ControlType.DataItem,
    ControlType.Image, ControlType.Text
  };

  public static string Press(string app, int x, int y) {
    Task<string> t = Task.Run(delegate { return PressNow(app, x, y); });
    return t.Wait(6000) ? t.Result : "none: the app did not answer in time";
  }
  static string PressNow(string app, int x, int y) {
    AutomationElement el = AutomationElement.FromPoint(new System.Windows.Point(x, y));
    if (el == null) return "none: no element at that point";
    Process owner = null;
    try { owner = Process.GetProcessById(el.Current.ProcessId); } catch { }
    if (!Matches(owner, app)) return "none: that point is in " + Describe(owner);
    List<string> seen = new List<string>();
    for (int i = 0; i < 6 && el != null; i++) {
      ControlType ct = el.Current.ControlType;
      string role = Role(ct), label = Clean(el.Current.Name, 40);
      seen.Add(role);
      if (ct == ControlType.Edit || ct == ControlType.Document && Editable(el)) { el.SetFocus(); return "focused " + role + " " + label; }
      // A web page or a read-only document is the frame around what was meant: a real click goes there.
      if (ct == ControlType.Window || ct == ControlType.Document) break;
      if (Array.IndexOf(Pressable, ct) >= 0) {
        object pat;
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out pat)) { ((InvokePattern)pat).Invoke(); return "pressed " + role + " " + label; }
        if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pat)) { ((TogglePattern)pat).Toggle(); return "pressed " + role + " " + label; }
        if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat)) { ((SelectionItemPattern)pat).Select(); return "pressed " + role + " " + label; }
      }
      el = TreeWalker.ControlViewWalker.GetParent(el);
    }
    return "none: " + string.Join(" < ", seen.ToArray());
  }

  /** A multi-line text box (UI Automation calls it a document) the owner could type in. */
  static bool Editable(AutomationElement el) {
    object pat;
    return el.TryGetCurrentPattern(ValuePattern.Pattern, out pat) && !((ValuePattern)pat).Current.IsReadOnly;
  }

  static uint IdleMs() {
    LASTINPUTINFO i = new LASTINPUTINFO(); i.size = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    GetLastInputInfo(ref i);
    return (uint)Environment.TickCount - i.time;
  }
  static INPUT Mouse(uint flags) { INPUT i = new INPUT(); i.type = 0; i.u.mi.flags = flags; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.vk = vk; i.u.ki.scan = scan; i.u.ki.flags = flags; return i; }
  static void Send(List<INPUT> list) {
    if (list.Count == 0) return;
    uint sent = SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    // Windows refuses input into a window running as administrator (or on the secure desktop) when APX is not.
    if (sent != list.Count) throw new Exception("Windows did not take the input (error " + Marshal.GetLastWin32Error() + "): the app may be running as administrator");
  }

  public static string Click(string app, int x, int y, int idleMs, int waitMs) {
    // A click mixed with the owner's own movement is lost: wait for a pause.
    int until = Environment.TickCount + waitMs;
    while (IdleMs() < idleMs) {
      if (Environment.TickCount > until) throw new Exception("the owner is using the mouse or keyboard right now: nothing was clicked, try again in a moment");
      Thread.Sleep(100);
    }
    POINT pt; pt.X = x; pt.Y = y;
    IntPtr top = GetAncestor(WindowFromPoint(pt), 2);
    Process p = top == IntPtr.Zero ? null : Proc(top);
    if (!Matches(p, app)) throw new Exception("another window covers that point (" + (p == null ? "none" : Describe(p)) + "): take a new screen_snapshot");
    POINT back; GetCursorPos(out back);
    SetCursorPos(x, y);
    Thread.Sleep(30);
    List<INPUT> down = new List<INPUT>(); down.Add(Mouse(0x0002)); Send(down);
    Thread.Sleep(30);
    List<INPUT> up = new List<INPUT>(); up.Add(Mouse(0x0004)); Send(up);
    Thread.Sleep(30);
    SetCursorPos(back.X, back.Y);
    return "";
  }

  public static string Keys(string app, int vk, string mods, bool extended) {
    Process p = FrontProc(app);
    List<INPUT> list = new List<INPUT>();
    List<ushort> held = new List<ushort>();
    foreach (string m in mods.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries)) held.Add(ushort.Parse(m));
    foreach (ushort m in held) list.Add(Key(m, 0, 0));
    uint ext = extended ? 1u : 0u;
    list.Add(Key((ushort)vk, 0, ext));
    list.Add(Key((ushort)vk, 0, ext | 2));
    held.Reverse();
    foreach (ushort m in held) list.Add(Key(m, 0, 2));
    Send(list);
    return Describe(p);
  }

  public static string Type(string app, string text) {
    FrontProc(app);
    try {
      AutomationElement f = AutomationElement.FocusedElement;
      if (f != null && f.Current.IsPassword) throw new ArgumentException("the focused field is a password field: the owner types it");
    } catch (ArgumentException) { throw; } catch { }
    List<INPUT> list = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\r') continue;
      if (c == '\n' || c == '\t') {
        ushort vk = (ushort)(c == '\n' ? 0x0D : 0x09);
        list.Add(Key(vk, 0, 0)); list.Add(Key(vk, 0, 2));
      } else { list.Add(Key(0, c, 4)); list.Add(Key(0, c, 4 | 2)); }
      if (list.Count >= 100) { Send(list); list.Clear(); Thread.Sleep(10); }
    }
    Send(list);
    return "";
  }

  public static string Open(string file, string args) {
    ProcessStartInfo psi = new ProcessStartInfo(file);
    psi.UseShellExecute = true;
    if (!string.IsNullOrEmpty(args)) psi.Arguments = "\"" + args.Replace("\"", "%22") + "\"";
    Process.Start(psi);
    return "";
  }

  /** A Start menu shortcut whose name is the app's: how apps without a registered program name are found. */
  public static string Shortcut(string app) {
    string w = Norm(app), near = "";
    string[] roots = {
      Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
      Environment.GetFolderPath(Environment.SpecialFolder.StartMenu)
    };
    // Folder by folder: one the owner cannot read must not hide the rest.
    Stack<string> dirs = new Stack<string>(roots);
    while (dirs.Count > 0) {
      string dir = dirs.Pop();
      try {
        foreach (string sub in Directory.GetDirectories(dir)) dirs.Push(sub);
        foreach (string f in Directory.GetFiles(dir, "*.lnk")) {
          string n = Norm(Path.GetFileNameWithoutExtension(f));
          if (n == w) return f;
          // "Brave" for "Brave Browser"; never an uninstaller.
          if (near == "" && n.Length >= 4 && !n.Contains("uninstall") && (w.Contains(n) || n.Contains(w))) near = f;
        }
      } catch { }
    }
    return near;
  }

  static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? "")); }
  static string Un(string s) { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); }

  /** One request line "id<TAB>op<TAB>base64 args…" → "id<TAB>ok|err<TAB>base64 answer". */
  public static string Handle(string line) {
    // An empty last argument is a trailing tab: only the line's end comes off.
    string[] f = line.TrimStart('\uFEFF').TrimEnd('\r', '\n').Split('\t');
    string id = f[0];
    try {
      string[] a = new string[f.Length - 2];
      for (int i = 2; i < f.Length; i++) a[i - 2] = Un(f[i]);
      string op = f[1], r;
      if (op == "front") r = Front(a[0] == "1", int.Parse(a[1]));
      else if (op == "top") r = TopAt(int.Parse(a[0]), int.Parse(a[1]));
      else if (op == "activate") r = Activate(a[0]);
      else if (op == "press") r = Press(a[0], int.Parse(a[1]), int.Parse(a[2]));
      else if (op == "click") r = Click(a[0], int.Parse(a[1]), int.Parse(a[2]), int.Parse(a[3]), int.Parse(a[4]));
      else if (op == "keys") r = Keys(a[0], int.Parse(a[1]), a[2], a[3] == "1");
      else if (op == "type") r = Type(a[0], a[1]);
      else if (op == "open") r = Open(a[0], a[1]);
      else if (op == "shortcut") r = Shortcut(a[0]);
      else throw new Exception("unknown " + op);
      return id + "\tok\t" + B64(r);
    } catch (Exception e) {
      Exception inner = e is AggregateException && e.InnerException != null ? e.InnerException : e;
      return id + "\terr\t" + B64(inner.Message);
    }
  }
}
'@
[ApxWin]::Init()
[Console]::Out.WriteLine("ready")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  [Console]::Out.WriteLine([ApxWin]::Handle($line))
}
`;

type Waiting = { ok(v: string): void; fail(e: Error): void; timer: NodeJS.Timeout };

/** The helper, started on first use and kept for the session; it ends with the app (its input closes). */
function createHelper() {
  let child: ChildProcessWithoutNullStreams | undefined;
  let ready: Promise<void> | undefined;
  let next = 1;
  const waiting = new Map<number, Waiting>();

  function start(): Promise<void> {
    if (child && ready) return ready;
    const file = path.join(electronApp.getPath("userData"), "computer-win.ps1");
    // Written at every start: an updated app brings its own helper.
    fs.writeFileSync(file, HELPER);
    const proc = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
      { windowsHide: true },
    );
    child = proc;
    let out = "";
    let err = "";
    ready = new Promise<void>((resolve, reject) => {
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        out += chunk;
        for (let i = out.indexOf("\n"); i >= 0; i = out.indexOf("\n")) {
          const line = out.slice(0, i).trim();
          out = out.slice(i + 1);
          if (line === "ready") resolve();
          const [id, status, body = ""] = line.split("\t");
          const w = waiting.get(Number(id));
          if (!w) continue;
          waiting.delete(Number(id));
          clearTimeout(w.timer);
          const text = Buffer.from(body, "base64").toString("utf8");
          if (status === "ok") w.ok(text);
          else w.fail(new Error(text.slice(0, 300) || "failed"));
        }
      });
      proc.stderr.on("data", (c: Buffer) => {
        err = (err + c.toString()).slice(-600);
      });
      proc.on("exit", () => {
        const why = new Error(`the Windows helper stopped${err ? `: ${err.trim().split("\n").at(-1)}` : ""}`);
        reject(why);
        for (const w of waiting.values()) {
          clearTimeout(w.timer);
          w.fail(why);
        }
        waiting.clear();
        if (child === proc) {
          child = undefined;
          ready = undefined;
        }
      });
    });
    return ready;
  }

  return async function call(op: string, args: (string | number)[], ms = CALL_MS): Promise<string> {
    await start();
    const id = next++;
    const line = [id, op, ...args.map((a) => Buffer.from(String(a), "utf8").toString("base64"))].join("\t");
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        fail(new Error("timed out"));
      }, ms);
      waiting.set(id, { ok, fail, timer });
      child?.stdin.write(`${line}\n`);
    });
  };
}

const call = createHelper();

const toPoints = (x: number, y: number) => screen.screenToDipPoint({ x, y });
const toPixels = (x: number, y: number) => {
  const p = screen.dipToScreenPoint({ x, y });
  return [Math.round(p.x), Math.round(p.y)] as const;
};

/** An app's name as the agent gives it: a name only, never a path, a switch or a program that runs commands. */
function appName(app: string): string {
  const name = app.trim();
  if (!/^[\p{L}\p{N} ._()&+-]{1,80}$/u.test(name) || REFUSED_APPS.test(name.replace(/\s+/g, "")))
    throw new Error(`cannot open "${app}" on Windows: name an app such as Google Chrome or Notepad`);
  return name;
}

export const windowsDriver: ComputerDriver = {
  async front(withElements) {
    const [head = "", window = "", bounds = "", ...lines] = (
      await call("front", [withElements ? "1" : "0", ELEMENTS_MS], withElements ? ELEMENTS_MS + CALL_MS : CALL_MS)
    ).split("\n");
    const [app = "", pid = ""] = head.split("\t");
    const [x, y, width, height] = bounds.split(",").map(Number);
    const real = [x, y, width, height].every(Number.isFinite) && (width ?? 0) > 0 && (height ?? 0) > 0;
    const b: Bounds | undefined = real
      ? screen.screenToDipRect(null, {
          x: x as number,
          y: y as number,
          width: width as number,
          height: height as number,
        })
      : undefined;
    // Element centers in points, like the window's bounds.
    const els = lines.filter(Boolean).map((l) => {
      const cols = l.split("\t");
      const [cx, cy] = (cols[4] ?? "").split(",").map(Number);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return l;
      const p = toPoints(cx as number, cy as number);
      return [...cols.slice(0, 4), `${Math.round(p.x)},${Math.round(p.y)}`].join("\t");
    });
    return { app, pid: Number(pid), window, bounds: b, lines: els } satisfies Front;
  },
  activate: (app) => call("activate", [app]).then(() => {}),
  async topAt(x, y) {
    const [pid, name = ""] = (await call("top", [...toPixels(x, y)])).split("\t");
    return pid ? { pid: Number(pid), name } : undefined;
  },
  async open(app, url) {
    if (url) {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:")
        throw new Error("only web addresses (http or https) open on Windows");
    }
    if (!app) {
      await call("open", [String(url), ""]);
      return;
    }
    const name = appName(app);
    const known = ALIASES[name.toLowerCase()];
    const tries = [...new Set([known, name, `${name}.exe`].filter((t): t is string => Boolean(t)))];
    for (const file of tries) {
      if (
        await call("open", [file, url ?? ""]).then(
          () => true,
          () => false,
        )
      )
        return;
    }
    const lnk = await call("shortcut", [name]);
    if (lnk) {
      await call("open", [lnk, url ?? ""]);
      return;
    }
    throw new Error(`could not open it: no app named ${app} on this computer`);
  },
  canPress: (keys) => parseWinKeys(keys) !== undefined,
  key(app, keys) {
    const k = parseWinKeys(keys);
    if (!k) throw new Error(`cannot press "${keys}"`);
    return call("keys", [app, k.vk, k.mods.join(","), k.extended ? "1" : "0"]);
  },
  press: (app, x, y) => call("press", [app, ...toPixels(x, y)]),
  click: (app, x, y) => call("click", [app, ...toPixels(x, y), 500, 5_000]).then(() => {}),
  // UI Automation can only replace a field's whole value: text goes in as typing, at the caret.
  insert: async () => false,
  paste: (app, text) => call("type", [app, text]).then(() => {}),
};
