import Foundation
import AppKit
import ApplicationServices
import Darwin

private func launchIdentity(pid: Int32) throws -> LaunchIdentity {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    let read = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size)
    guard read == size, info.pbi_pid == UInt32(pid), info.pbi_start_tvsec > 0 else {
        throw ObserverFailure.identityMismatch
    }
    return LaunchIdentity(seconds: info.pbi_start_tvsec, microseconds: info.pbi_start_tvusec)
}

private func validateProcess(_ request: ObserveRequest) throws {
    try validateSelectionProcess(ProcessTarget(pid: request.pid, launchIdentity: request.launchIdentity))
}

func validateSelectionProcess(_ request: ProcessTarget) throws {
    let identity = try launchIdentity(pid: request.pid)
    guard let app = NSRunningApplication(processIdentifier: request.pid), !app.isTerminated else {
        throw ObserverFailure.identityMismatch
    }
    try validateProcessIdentity(expected: request.launchIdentity, actual: identity, bundleID: app.bundleIdentifier)
}

private func validateCGWindow(_ request: ObserveRequest) throws {
    guard let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, request.windowID) as? [[String: Any]],
          windows.count == 1, let window = windows.first,
          let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
          owner.int32Value == request.pid,
          let number = window[kCGWindowNumber as String] as? NSNumber,
          number.uint32Value == request.windowID,
          let layer = window[kCGWindowLayer as String] as? NSNumber, layer.intValue == 0 else {
        throw ObserverFailure.windowUnresolved
    }
}

struct NativeNodeSource: WindowNodeSource {
    let budget: WorkBudget
    let pid: Int32
    var scopedWindow: AXUIElement? = nil
    var onAttributeRequest: ((AXUIElement, String) -> Void)? = nil

    func same(_ left: AXUIElement, _ right: AXUIElement) -> Bool { CFEqual(left, right) }

    func prepare(_ element: AXUIElement) throws {
        try budget.check()
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == pid,
              AXUIElementSetMessagingTimeout(element, 0.1) == .success else {
            throw ObserverFailure.unavailable
        }
        try budget.check()
        if let scopedWindow, !CFEqual(element, scopedWindow) {
            var containing: CFTypeRef?
            onAttributeRequest?(element, kAXWindowAttribute)
            let status = AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &containing)
            try budget.check()
            guard status == .success, let containing,
                  CFGetTypeID(containing) == AXUIElementGetTypeID(), CFEqual(containing, scopedWindow) else {
                throw ObserverFailure.windowUnresolved
            }
        }
    }

    func attribute(_ element: AXUIElement, _ name: String, optional: Bool = false) throws -> CFTypeRef? {
        try prepare(element)
        var result: CFTypeRef?
        onAttributeRequest?(element, name)
        let status = AXUIElementCopyAttributeValue(element, name as CFString, &result)
        try budget.check()
        if optional && (status == .attributeUnsupported || status == .noValue) { return nil }
        guard status == .success, result != nil else { throw ObserverFailure.unavailable }
        return result
    }

    func metadata(_ element: AXUIElement) throws -> NodeMetadata {
        guard let role = try attribute(element, kAXRoleAttribute) as? String, !role.isEmpty else {
            throw ObserverFailure.unavailable
        }
        let subrole = try attribute(element, kAXSubroleAttribute, optional: true)
        guard subrole == nil || subrole is String else { throw ObserverFailure.unavailable }
        return NodeMetadata(role: role, subrole: subrole as? String)
    }

    func title(_ element: AXUIElement) throws -> String? {
        let value = try attribute(element, kAXTitleAttribute, optional: true)
        guard value == nil || value is String else { throw ObserverFailure.unavailable }
        return value as? String
    }

    func elements(_ element: AXUIElement, attribute name: String, cap: Int) throws -> [AXUIElement] {
        try prepare(element)
        var count: CFIndex = 0
        onAttributeRequest?(element, name)
        let status = AXUIElementGetAttributeValueCount(element, name as CFString, &count)
        try budget.check()
        if status == .attributeUnsupported || status == .noValue { return [] }
        guard status == .success, count >= 0 else { throw ObserverFailure.unavailable }
        guard count <= cap else { throw ObserverFailure.limitExceeded }
        if count == 0 { return [] }
        var values: CFArray?
        onAttributeRequest?(element, name)
        let copied = AXUIElementCopyAttributeValues(element, name as CFString, 0, count, &values)
        try budget.check()
        guard copied == .success, let values, CFArrayGetCount(values) == count else {
            throw ObserverFailure.unavailable
        }
        var elements: [AXUIElement] = []
        for item in values as [AnyObject] {
            guard CFGetTypeID(item) == AXUIElementGetTypeID() else { throw ObserverFailure.unavailable }
            elements.append(item as! AXUIElement)
        }
        return elements
    }

    func children(_ element: AXUIElement) throws -> [AXUIElement] {
        try elements(element, attribute: kAXChildrenAttribute, cap: 256)
    }

    func windowNumber(_ window: AXUIElement) throws -> UInt32 {
        guard let number = try attribute(window, "AXWindowNumber") as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue > 0, number.doubleValue <= Double(UInt32.max),
              number.doubleValue.rounded(.towardZero) == number.doubleValue else {
            throw ObserverFailure.windowUnresolved
        }
        return number.uint32Value
    }
}

func observeNative(_ request: ObserveRequest, session: inout ObservationSession) throws -> Observation {
    let budget = WorkBudget()
    try validateProcess(request)
    try validateCGWindow(request)
    guard AXIsProcessTrusted() else { throw ObserverFailure.unavailable }
    let source = NativeNodeSource(budget: budget, pid: request.pid)
    let application = AXUIElementCreateApplication(request.pid)
    let windows = try source.elements(application, attribute: kAXWindowsAttribute, cap: 64)
    var candidates: [(element: AXUIElement, number: UInt32?)] = []
    for window in windows {
        guard try source.metadata(window).role == kAXWindowRole else { throw ObserverFailure.windowUnresolved }
        candidates.append((window, try source.windowNumber(window)))
    }
    let selected = try resolveExactWindow(candidates, requested: request.windowID)
    let scopedSource = NativeNodeSource(budget: budget, pid: request.pid, scopedWindow: selected)
    var traversal = WindowTraversal(source: scopedSource, budget: budget)
    guard let root = try traversal.read(selected, session: &session) else { throw ObserverFailure.windowUnresolved }
    guard try scopedSource.windowNumber(selected) == request.windowID else { throw ObserverFailure.windowUnresolved }
    try validateCGWindow(request)
    try validateProcess(request)
    try budget.check()
    return Observation(session: session.id, generation: session.generation, pid: request.pid,
                       launchIdentity: request.launchIdentity, windowID: request.windowID, nodes: [root])
}
