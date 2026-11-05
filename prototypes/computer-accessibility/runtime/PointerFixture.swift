import AppKit

private final class FixtureButton: NSButton {
    override func mouseDown(with event: NSEvent) {
        print("FIXTURE_PHYSICAL_MOUSE_DOWN")
        fflush(stdout)
        super.mouseDown(with: event)
    }
}

final class PointerFixture: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var counter = 0
    private let status = NSTextField(labelWithString: "Completed actions: 0")

    @objc private func increment(_ sender: Any?) {
        counter += 1
        status.stringValue = "Completed actions: \(counter)"
        print("FIXTURE_COUNT \(counter)")
        fflush(stdout)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let root = NSMenuItem()
        let actions = NSMenu(title: "Fixture")
        let incrementItem = NSMenuItem(title: "Increment counter", action: #selector(increment(_:)), keyEquivalent: "")
        incrementItem.target = self
        actions.addItem(incrementItem)
        root.submenu = actions
        menu.addItem(root)
        NSApp.mainMenu = menu
        let w = NSWindow(contentRect: NSRect(x: 280, y: 240, width: 560, height: 340),
                         styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.title = "Acme pointer fixture"
        let button = FixtureButton(title: "Increment counter", target: self, action: #selector(increment(_:)))
        button.frame = NSRect(x: 40, y: 220, width: 240, height: 44)
        w.contentView?.addSubview(button)
        status.frame = NSRect(x: 40, y: 170, width: 360, height: 32)
        w.contentView?.addSubview(status)
        let alternate = FixtureButton(title: "Increment alternate", target: self, action: #selector(increment(_:)))
        alternate.frame = NSRect(x: 40, y: 100, width: 240, height: 44)
        w.contentView?.addSubview(alternate)
        let disabled = NSButton(title: "Disabled control", target: self, action: #selector(increment(_:)))
        disabled.frame = NSRect(x: 320, y: 100, width: 200, height: 44)
        disabled.isEnabled = false
        w.contentView?.addSubview(disabled)
        let secure = NSSecureTextField()
        secure.placeholderString = "Synthetic secure field"
        secure.stringValue = "Synthetic"
        secure.isEditable = false
        secure.isSelectable = false
        secure.frame = NSRect(x: 40, y: 40, width: 240, height: 32)
        w.contentView?.addSubview(secure)
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        print("FIXTURE_READY")
        fflush(stdout)
        DispatchQueue.global().async {
            while let command = readLine() {
                DispatchQueue.main.async {
                    if command == "status" {
                        print("FIXTURE_COUNT \(self.counter)")
                        fflush(stdout)
                    } else if command == "pointer", let point = CGEvent(source: nil)?.location {
                        print("FIXTURE_POINTER \(point.x),\(point.y)")
                        fflush(stdout)
                    } else if command.hasPrefix("timing ") {
                        let timing = command.dropFirst(7).prefix(80)
                        self.status.stringValue = "Completed actions: \(self.counter) · \(timing)"
                    } else if command == "quit" {
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }
}

let app = NSApplication.shared
let fixture = PointerFixture()
app.delegate = fixture
app.setActivationPolicy(.regular)
app.run()
