import Foundation
import ApplicationServices

struct NativeSelectionBackend: RetainedWindowBackend {
    func same(_ left: AXUIElement, _ right: AXUIElement) -> Bool { CFEqual(left, right) }

    func validate(_ target: ProcessTarget, budget: WorkBudget) throws {
        try budget.check()
        try validateSelectionProcess(target)
        try budget.check()
        guard AXIsProcessTrusted() else { throw ObserverFailure.unavailable }
    }

    func windows(_ target: ProcessTarget, budget: WorkBudget) throws -> [AXUIElement] {
        let source = NativeNodeSource(budget: budget, pid: target.pid)
        return try source.elements(AXUIElementCreateApplication(target.pid), attribute: kAXWindowsAttribute, cap: 64)
    }

    func validateWindow(_ window: AXUIElement, target: ProcessTarget, budget: WorkBudget) throws {
        let source = NativeNodeSource(budget: budget, pid: target.pid)
        guard try source.metadata(window).role == kAXWindowRole else { throw ObserverFailure.windowUnresolved }
    }

    func windowTitle(_ window: AXUIElement, target: ProcessTarget, budget: WorkBudget) throws -> String? {
        let source = NativeNodeSource(budget: budget, pid: target.pid)
        let metadata = try source.metadata(window)
        guard metadata.role == kAXWindowRole, !metadata.redacted else { throw ObserverFailure.windowUnresolved }
        return try source.title(window)
    }

    func read(_ window: AXUIElement, target: ProcessTarget, budget: WorkBudget,
              session: inout ObservationSession) throws -> ObservedNode {
        let source = NativeNodeSource(budget: budget, pid: target.pid, scopedWindow: window)
        var traversal = WindowTraversal(source: source, budget: budget)
        guard let root = try traversal.read(window, session: &session) else { throw ObserverFailure.windowUnresolved }
        return root
    }
}
