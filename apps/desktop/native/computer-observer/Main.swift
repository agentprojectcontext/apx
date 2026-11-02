import Foundation
import Darwin

@main
struct NativeObserverMain {
    static func main() {
        let status = CommandLine.arguments == [CommandLine.arguments[0], "--pointer"] ? runPointerRuntime() : run()
        close(STDIN_FILENO)
        close(STDOUT_FILENO)
        close(STDERR_FILENO)
        if status != 0 { Darwin.exit(status) }
    }

    static func run() -> Int32 {
        guard supportedTransport(STDIN_FILENO, writing: false),
              supportedTransport(STDOUT_FILENO, writing: true) else { return 1 }
        signal(SIGPIPE, SIG_IGN)
        var controller = WindowSelectionController(backend: NativeSelectionBackend())
        var framer = InputFramer()
        var ready = false
        var hello = Data()
        var failed = false
        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        func write(_ data: Data) {
            var line = data
            line.append(10)
            let success = line.withUnsafeBytes { bytes -> Bool in
                var offset = 0
                while offset < bytes.count {
                    let count = Darwin.write(STDOUT_FILENO, bytes.baseAddress?.advanced(by: offset), bytes.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { return false }
                    offset += count
                }
                return true
            }
            if !success { failed = true }
        }
        let emit: (Data?) -> Void = { input in
            guard !failed else { return }
            autoreleasepool {
                write(handleObserverFrame(input) { controller.handle($0, observe: observeNative) })
            }
        }
        var bytes = [UInt8](repeating: 0, count: 4096)
        while !failed {
            if !ready {
                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline else { return 1 }
                var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
                let timeout = Int32((deadline - now + 999_999) / 1_000_000)
                let result = poll(&descriptor, 1, timeout)
                if result < 0 && errno == EINTR { continue }
                guard result > 0, descriptor.revents & Int16(POLLERR | POLLHUP | POLLNVAL) == 0 else { return 1 }
            }
            let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
            if count == 0 {
                guard ready else { return 1 }
                framer.finish(emit: emit)
                break
            }
            if count < 0 {
                if errno == EINTR { continue }
                return 1
            }
            if !ready {
                hello.append(contentsOf: bytes.prefix(count))
                guard hello.count <= 8193 else { return 1 }
                guard let newline = hello.firstIndex(of: 10) else {
                    if hello.count > 8192 { return 1 }
                    continue
                }
                guard newline == hello.index(before: hello.endIndex),
                      isTransportHello(Data(hello[..<newline])),
                      supportedTransport(STDIN_FILENO, writing: false),
                      supportedTransport(STDOUT_FILENO, writing: true),
                      transportInputQuiet(STDIN_FILENO) else { return 1 }
                write(Data("{\"version\":1,\"ready\":true}".utf8))
                if !failed { ready = true }
                hello.removeAll()
            } else {
                framer.feed(Data(bytes.prefix(count)), emit: emit)
            }
        }
        return failed ? 1 : 0
    }
}
