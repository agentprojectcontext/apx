import Foundation
import AppKit
import Darwin

private final class PointerOutput {
    private let lock = NSLock()
    func send(_ object: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
        data.append(10)
        data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(STDOUT_FILENO, bytes.baseAddress?.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { return }
                offset += count
            }
        }
    }
}

private final class PointerRuntime {
    private let overlay = PointerOverlay()
    private let output = PointerOutput()
    private let actions = DispatchQueue(label: "dev.apx.pointer-actions")
    private let lock = NSLock()
    private var stopped = false

    private func invalidate() {
        lock.lock()
        stopped = true
        lock.unlock()
    }

    func stop() {
        invalidate()
        overlay.hide()
        NSApp.terminate(nil)
    }

    private func check() throws {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped else { throw PointerActionFailure(reason: "cancelled", uncertain: false) }
    }

    func start() {
        output.send(["version": 1, "ready": true])
        DispatchQueue.global().async { [self] in
            var bytes = [UInt8](repeating: 0, count: 4096)
            var buffer = Data()
            while true {
                let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
                if count < 0 && errno == EINTR { continue }
                if count <= 0 { break }
                for byte in bytes.prefix(count) {
                    if byte == 10 {
                        let frame = buffer
                        buffer.removeAll(keepingCapacity: true)
                        DispatchQueue.main.async { self.receive(frame) }
                    } else {
                        buffer.append(byte)
                        if buffer.count > 8192 {
                            invalidate()
                            DispatchQueue.main.async { self.stop() }
                            return
                        }
                    }
                }
            }
            invalidate()
            DispatchQueue.main.async { self.stop() }
        }
    }

    private func receive(_ data: Data) {
        guard (try? check()) != nil else { return }
        guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let number = value["id"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue > 0, number.doubleValue <= 9007199254740991,
              number.doubleValue.rounded() == number.doubleValue, let op = value["op"] as? String,
              Set(value.keys).isSubset(of: ["id", "op", "x", "y", "agent", "label", "app"]),
              let agent = value["agent"] as? String, !agent.isEmpty, agent.utf8.count <= 128,
              let label = value["label"] as? String, label.count <= 80 else { stop(); return }
        let id = number.int64Value
        let reply = { [self] in output.send(["id": id, "status": "accepted"]) }
        switch op {
        case "move", "press":
            guard let x = value["x"] as? NSNumber, let y = value["y"] as? NSNumber,
                  CFGetTypeID(x) != CFBooleanGetTypeID(), CFGetTypeID(y) != CFBooleanGetTypeID(),
                  x.doubleValue.isFinite, y.doubleValue.isFinite,
                  abs(x.doubleValue) <= 100000, abs(y.doubleValue) <= 100000 else { stop(); return }
            let point = CGPoint(x: x.doubleValue, y: y.doubleValue)
            if op == "move" {
                overlay.move(agent: agent, label: label, point: point, completion: reply)
            } else {
                guard let app = value["app"] as? String, !app.isEmpty, app.utf8.count <= 256 else { stop(); return }
                let ownWindows = overlay.windowIDs
                actions.async { [self] in
                    let began = DispatchTime.now().uptimeNanoseconds
                    do {
                        let role = try performPointerAction(NativePointerAction(appName: app, destination: point, ownWindows: ownWindows), check: check)
                        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000
                        output.send(["id": id, "status": "accepted", "action": "pressed", "role": role, "durationMs": elapsed])
                    } catch let error as PointerActionFailure {
                        output.send(["id": id, "status": error.uncertain ? "uncertain" : "unsupported", "reason": error.reason])
                    } catch {
                        output.send(["id": id, "status": "uncertain", "reason": "native_failure"])
                    }
                }
            }
        case "say": overlay.say(agent: agent, label: label, completion: reply)
        case "pulse": overlay.pulse(agent: agent); reply()
        case "hide": overlay.hide(); reply()
        default: stop()
        }
    }
}

func runPointerRuntime() -> Int32 {
    guard supportedTransport(STDIN_FILENO, writing: false), supportedTransport(STDOUT_FILENO, writing: true) else { return 1 }
    signal(SIGPIPE, SIG_IGN)
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let runtime = PointerRuntime()
    DispatchQueue.main.async { runtime.start() }
    app.run()
    return 0
}
