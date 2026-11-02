import Foundation

func validateProcessIdentity(expected: LaunchIdentity, actual: LaunchIdentity, bundleID: String?) throws {
    guard expected == actual, let bundleID, !bundleID.isEmpty else { throw ObserverFailure.identityMismatch }
    guard !isDeniedBrowser(bundleID) else { throw ObserverFailure.browserDenied }
}

func resolveExactWindow<Element>(_ windows: [(element: Element, number: UInt32?)], requested: UInt32) throws -> Element {
    guard !windows.isEmpty, windows.count <= 64, windows.allSatisfy({ $0.number != nil }) else {
        throw ObserverFailure.windowUnresolved
    }
    let matches = windows.filter { $0.number == requested }
    guard matches.count == 1, let match = matches.first else { throw ObserverFailure.windowUnresolved }
    return match.element
}
