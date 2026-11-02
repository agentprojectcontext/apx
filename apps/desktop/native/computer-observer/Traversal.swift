import Foundation
import Dispatch

final class WorkBudget {
    private let now: () -> UInt64
    private let started: UInt64
    private let duration: UInt64
    private var count = 0

    init(duration: UInt64 = 2_000_000_000, now: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }) {
        self.now = now
        self.started = now()
        self.duration = duration
    }

    func check() throws {
        let current = now()
        guard current >= started, current - started < duration else { throw ObserverFailure.deadlineExceeded }
    }

    func visit(depth: Int) throws {
        try check()
        guard depth <= 16, count < 256 else { throw ObserverFailure.limitExceeded }
        count += 1
    }
}

protocol WindowNodeSource {
    associatedtype Element
    func same(_ left: Element, _ right: Element) -> Bool
    func metadata(_ element: Element) throws -> NodeMetadata
    func title(_ element: Element) throws -> String?
    func children(_ element: Element) throws -> [Element]
}

struct WindowTraversal<Source: WindowNodeSource> {
    let source: Source
    let budget: WorkBudget
    private var visited: [Source.Element] = []

    init(source: Source, budget: WorkBudget) {
        self.source = source
        self.budget = budget
    }

    mutating func read(_ element: Source.Element, session: inout ObservationSession, depth: Int = 0) throws -> ObservedNode? {
        try budget.visit(depth: depth)
        guard !visited.contains(where: { source.same($0, element) }) else { throw ObserverFailure.unsupported }
        visited.append(element)
        let metadata = try source.metadata(element)
        guard !metadata.excluded else { return nil }
        let ref = session.makeRef()
        let title = metadata.permitsTitle ? boundedTitle(try source.title(element)) : nil
        var children: [ObservedNode] = []
        if !metadata.redacted {
            try budget.check()
            for child in try source.children(element) {
                if let result = try read(child, session: &session, depth: depth + 1) { children.append(result) }
            }
        }
        try budget.check()
        return ObservedNode(ref: ref, role: publicRole(metadata.role), title: title,
                            redacted: metadata.redacted, children: children)
    }
}

private func publicRole(_ role: String) -> String {
    let allowed = ["AXWindow", "AXGroup", "AXButton", "AXCheckBox", "AXRadioButton", "AXStaticText",
                   "AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField", "AXScrollArea",
                   "AXSplitGroup", "AXTabGroup", "AXToolbar", "AXTable", "AXRow", "AXColumn",
                   "AXCell", "AXSlider", "AXImage", "AXProgressIndicator", "AXValueIndicator"]
    return allowed.contains(role) ? role : "AXUnknown"
}
