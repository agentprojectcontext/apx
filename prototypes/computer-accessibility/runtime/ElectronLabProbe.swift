import Foundation
import ApplicationServices

struct ElectronLabRequest: Decodable {
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let urls: [String]
}

struct LabResult: Encodable {
    var version = 1
    var windowCount: Int?
    var observations: [LabObservation] = []
    var error: String?
    var readAudit: NativeReadSummary?
    var navigationPaused = false
}

struct LabObservation: Encodable {
    let alpha: Bool
    let beta: Bool
    let sentinelsAbsent: Bool
    let nodes: Int
}

private final class NavigationPause {
    private(set) var paused = false
    func afterAllowedDocument() throws {
        guard ProcessInfo.processInfo.environment["OBSERVER_LAB_PAUSE_ROOT"] == "1", !paused else { return }
        paused = true
        try FileHandle(fileDescriptor: 4, closeOnDealloc: false).write(contentsOf: Data([1]))
        let ack = try FileHandle(fileDescriptor: 3, closeOnDealloc: false).read(upToCount: 1)
        guard ack == Data([1]) else { throw ObserverFailure.unavailable }
    }
}

@main
struct ElectronLabProbe {
    static func main() {
        var result = LabResult()
        let audit = NativeReadAudit()
        let navigation = NavigationPause()
        do {
            let data = FileHandle.standardInput.readData(ofLength: 8193)
            guard data.count <= 8192, let request = try? JSONDecoder().decode(ElectronLabRequest.self, from: data),
                  request.pid > 0, request.launchIdentity.seconds > 0,
                  request.launchIdentity.microseconds < 1_000_000,
                  request.urls.count == 2, Set(request.urls).count == 2,
                  request.urls.allSatisfy({ $0.hasPrefix("data:text/html;charset=utf-8,") && $0.utf8.count <= 3500 }) else {
                throw ObserverFailure.invalidRequest
            }
            guard let authorityText = ProcessInfo.processInfo.environment["OBSERVER_LAB_AUTHORITY"],
                  let authority = try? JSONDecoder().decode(ElectronLabRequest.self, from: Data(authorityText.utf8)),
                  authority.pid == request.pid, authority.launchIdentity == request.launchIdentity,
                  authority.urls == request.urls else { throw ObserverFailure.identityMismatch }
            let target = ProcessTarget(pid: request.pid, launchIdentity: request.launchIdentity)
            let backend = NativeSelectionBackend()
            let budget = WorkBudget()
            try backend.validate(target, budget: budget)
            let windows = try backend.windows(target, budget: budget)
            guard windows.count == 2, !CFEqual(windows[0], windows[1]) else { throw ObserverFailure.windowUnresolved }
            result.windowCount = windows.count
            var observations: [LabObservation] = []
            for window in windows {
                try backend.validateWindow(window, target: target, budget: budget)
                let source = SyntheticRendererSource(
                    native: AuditedRendererSource(native: NativeNodeSource(budget: budget, pid: request.pid,
                        scopedWindow: window, onAttributeRequest: audit.requested), audit: audit, urls: Set(request.urls)),
                    urls: Set(request.urls), onAllowedDocument: navigation.afterAllowedDocument)
                var traversal = WindowTraversal(source: source, budget: budget)
                var session = ObservationSession()
                guard let root = try traversal.read(window, session: &session) else { throw ObserverFailure.windowUnresolved }
                try backend.validateWindow(window, target: target, budget: budget)
                let current = try backend.windows(target, budget: budget)
                guard current.filter({ CFEqual($0, window) }).count == 1 else { throw ObserverFailure.windowUnresolved }
                let encoded = try JSONEncoder().encode(root)
                guard encoded.count <= 65_536 else { throw ObserverFailure.limitExceeded }
                let text = String(decoding: encoded, as: UTF8.self)
                observations.append(LabObservation(alpha: text.contains("Increment alpha"),
                    beta: text.contains("Increment beta"), sentinelsAbsent: !text.contains("SYNTHETIC_"),
                    nodes: count(root)))
            }
            try backend.validate(target, budget: budget)
            try budget.check()
            result.observations = observations
        } catch let error as ObserverFailure {
            result.error = error.rawValue
        } catch {
            result.error = ObserverFailure.unavailable.rawValue
        }
        result.readAudit = audit.summary
        result.navigationPaused = navigation.paused
        if let data = try? JSONEncoder().encode(result) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
        }
    }

    static func count(_ node: ObservedNode) -> Int { 1 + node.children.reduce(0) { $0 + count($1) } }
}
