import Foundation
import ApplicationServices
import AppKit

struct PointerActionFailure: Error {
    let reason: String
    let uncertain: Bool
}

protocol PointerActionBackend {
    associatedtype Target
    func resolve() throws -> Target
    func validate(_ target: Target) throws
    func press(_ target: Target) throws -> String
}

func performPointerAction<B: PointerActionBackend>(_ backend: B, check: () throws -> Void) throws -> String {
    var delivering = false
    do {
        try check()
        let target = try backend.resolve()
        try check()
        try backend.validate(target)
        try check()
        delivering = true
        return try backend.press(target)
    } catch let error as PointerActionFailure {
        throw PointerActionFailure(reason: error.reason, uncertain: delivering || error.uncertain)
    } catch {
        throw PointerActionFailure(reason: "native_failure", uncertain: delivering)
    }
}

func validatePointerClassification(role: String, subrole: String?) throws {
    guard role != "AXWebArea" else { throw PointerActionFailure(reason: "web_content", uncertain: false) }
    let field = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSearchField"].contains(role)
    guard role != "AXSecureTextField", subrole != "AXSecureTextField", !field || !(subrole ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw PointerActionFailure(reason: "secure_or_unclassified_field", uncertain: false)
    }
}

private func pointerAttribute(_ element: AXUIElement, _ name: String, optional: Bool = false) throws -> CFTypeRef? {
    guard AXUIElementSetMessagingTimeout(element, 0.2) == .success else {
        throw PointerActionFailure(reason: "accessibility_unavailable", uncertain: false)
    }
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    if optional && (status == .attributeUnsupported || status == .noValue) { return nil }
    guard status == .success, value != nil else {
        throw PointerActionFailure(reason: "accessibility_unavailable", uncertain: false)
    }
    return value
}

private func pointerElement(_ element: AXUIElement, _ name: String) throws -> AXUIElement {
    guard let value = try pointerAttribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else {
        throw PointerActionFailure(reason: "accessibility_unavailable", uncertain: false)
    }
    return value as! AXUIElement
}

struct PointerNativeTarget {
    let app: NSRunningApplication
    let launch: Date?
    let window: AXUIElement
    let windowID: CGWindowID
    let chain: [AXUIElement]
    let control: AXUIElement
    let role: String
}

struct NativePointerAction: PointerActionBackend {
    let appName: String
    let destination: CGPoint
    let ownWindows: Set<CGWindowID>

    private func hit(_ pid: pid_t) throws -> (window: AXUIElement, chain: [AXUIElement], control: AXUIElement, role: String) {
        var value: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(destination.x), Float(destination.y), &value) == .success,
              var current = value else { throw PointerActionFailure(reason: "destination_unavailable", uncertain: false) }
        var chain: [AXUIElement] = []
        var window: AXUIElement?
        var action: (AXUIElement, String)?
        for _ in 0..<32 {
            var owner: pid_t = 0
            guard AXUIElementGetPid(current, &owner) == .success, owner == pid,
                  !chain.contains(where: { CFEqual($0, current) }),
                  let role = try pointerAttribute(current, kAXRoleAttribute) as? String else {
                throw PointerActionFailure(reason: "destination_changed", uncertain: false)
            }
            chain.append(current)
            let subrole = try pointerAttribute(current, kAXSubroleAttribute, optional: true) as? String
            try validatePointerClassification(role: role, subrole: subrole)
            if role == kAXWindowRole { window = current }
            if action == nil && window == nil {
                var names: CFArray?
                if AXUIElementCopyActionNames(current, &names) == .success,
                   let actions = names as? [String], actions.contains(kAXPressAction) { action = (current, role) }
            }
            if role == kAXApplicationRole {
                guard let window, let action else { throw PointerActionFailure(reason: "no_supported_action", uncertain: false) }
                return (window, chain, action.0, action.1)
            }
            current = try pointerElement(current, kAXParentAttribute)
        }
        throw PointerActionFailure(reason: "destination_unavailable", uncertain: false)
    }

    private func windowID(_ window: AXUIElement, pid: pid_t) throws -> CGWindowID {
        guard let position = try pointerAttribute(window, kAXPositionAttribute),
              let size = try pointerAttribute(window, kAXSizeAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
            throw PointerActionFailure(reason: "window_unavailable", uncertain: false)
        }
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0) as? [[String: Any]] else {
            throw PointerActionFailure(reason: "window_unavailable", uncertain: false)
        }
        let bounds = CGRect(origin: point, size: dimensions)
        var matches: [CGWindowID] = []
        for candidate in windows {
            guard let number = candidate[kCGWindowNumber as String] as? NSNumber, !ownWindows.contains(number.uint32Value),
                  (candidate[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (candidate[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let rectangle = candidate[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: rectangle as CFDictionary), rect.contains(destination),
                  abs(rect.minX - bounds.minX) <= 2, abs(rect.minY - bounds.minY) <= 2,
                  abs(rect.width - bounds.width) <= 2, abs(rect.height - bounds.height) <= 2 else { continue }
            matches.append(number.uint32Value)
        }
        guard matches.count == 1, let id = matches.first else { throw PointerActionFailure(reason: "window_unavailable", uncertain: false) }
        return id
    }

    func resolve() throws -> PointerNativeTarget {
        guard AXIsProcessTrusted() else { throw PointerActionFailure(reason: "accessibility_permission", uncertain: false) }
        let apps = NSWorkspace.shared.runningApplications.filter { $0.localizedName == appName && !$0.isTerminated }
        guard apps.count == 1, let app = apps.first else { throw PointerActionFailure(reason: "application_unavailable", uncertain: false) }
        let result = try hit(app.processIdentifier)
        return PointerNativeTarget(app: app, launch: app.launchDate, window: result.window,
                                   windowID: try windowID(result.window, pid: app.processIdentifier),
                                   chain: result.chain, control: result.control, role: result.role)
    }

    func validate(_ target: PointerNativeTarget) throws {
        guard AXIsProcessTrusted(), !target.app.isTerminated, target.app.launchDate == target.launch else {
            throw PointerActionFailure(reason: "application_changed", uncertain: false)
        }
        for button in 0..<5 where CGEventSource.buttonState(.combinedSessionState, button: CGMouseButton(rawValue: UInt32(button))!) {
            throw PointerActionFailure(reason: "mouse_button_held", uncertain: false)
        }
        let current = try hit(target.app.processIdentifier)
        guard CFEqual(current.window, target.window), CFEqual(current.control, target.control),
              current.role == target.role, current.chain.count == target.chain.count,
              zip(current.chain, target.chain).allSatisfy({ CFEqual($0, $1) }),
              try windowID(current.window, pid: target.app.processIdentifier) == target.windowID,
              (try pointerAttribute(current.control, kAXEnabledAttribute) as? Bool) == true else {
            throw PointerActionFailure(reason: "destination_changed_or_disabled", uncertain: false)
        }
    }

    func press(_ target: PointerNativeTarget) throws -> String {
        guard AXUIElementPerformAction(target.control, kAXPressAction as CFString) == .success else {
            throw PointerActionFailure(reason: "press_uncertain", uncertain: true)
        }
        return target.role
    }
}
