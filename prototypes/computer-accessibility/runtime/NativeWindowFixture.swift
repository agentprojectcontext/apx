import AppKit

final class WindowFixture: NSObject, NSApplicationDelegate {
    private var windows: [NSWindow] = []

    private func makeWindow(_ marker: String) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 180, y: 240, width: 520, height: 320),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "Acme identical windows"
        let button = NSButton(title: marker, target: nil, action: nil)
        button.frame = NSRect(x: 24, y: 180, width: 260, height: 40)
        window.contentView?.addSubview(button)
        let secret = NSSecureTextField(string: "SYNTHETIC_REDACTION_SENTINEL")
        secret.frame = NSRect(x: 24, y: 110, width: 260, height: 40)
        window.contentView?.addSubview(secret)
        window.makeKeyAndOrderFront(nil)
        return window
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        windows = [makeWindow("Fixture alpha"), makeWindow("Fixture beta")]
        print("FIXTURE_READY")
        fflush(stdout)
        DispatchQueue.global().async {
            while let command = readLine() {
                DispatchQueue.main.async { self.handle(command) }
            }
        }
    }

    private func handle(_ command: String) {
        switch command {
        case "reorder": windows.first?.orderFront(nil)
        case "replace-alpha":
            guard let old = windows.first else { return }
            old.close()
            windows[0] = makeWindow("Fixture replacement")
        case "close-beta": windows.last?.close()
        case "quit": NSApp.terminate(nil)
        default:
            print("FIXTURE_UNKNOWN")
            fflush(stdout)
            return
        }
        print("FIXTURE_DONE")
        fflush(stdout)
    }
}

let app = NSApplication.shared
let fixture = WindowFixture()
app.delegate = fixture
app.setActivationPolicy(.regular)
app.run()
