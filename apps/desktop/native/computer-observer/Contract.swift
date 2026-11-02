import Foundation

enum ObserverFailure: String, Error {
    case invalidRequest = "INVALID_REQUEST"
    case identityMismatch = "IDENTITY_MISMATCH"
    case browserDenied = "BROWSER_DENIED"
    case unavailable = "UNAVAILABLE"
    case windowUnresolved = "WINDOW_UNRESOLVED"
    case limitExceeded = "LIMIT_EXCEEDED"
    case deadlineExceeded = "DEADLINE_EXCEEDED"
    case unsupported = "UNSUPPORTED"
}

struct LaunchIdentity: Codable, Equatable {
    let seconds: UInt64
    let microseconds: UInt64
}

struct ObserveRequest: Decodable {
    let op: String
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let windowID: UInt32

    static func parse(_ data: Data) throws -> ObserveRequest {
        guard data.count <= 8192,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["op", "pid", "launchIdentity", "windowID"]),
              let launch = object["launchIdentity"] as? [String: Any],
              Set(launch.keys) == Set(["seconds", "microseconds"]),
              let request = try? JSONDecoder().decode(Self.self, from: data),
              request.op == "observe", request.pid > 0, request.windowID > 0,
              request.launchIdentity.seconds > 0, request.launchIdentity.microseconds < 1_000_000
        else { throw ObserverFailure.invalidRequest }
        return request
    }
}

struct NodeMetadata {
    let role: String
    let subrole: String?

    var redacted: Bool {
        ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"].contains(role)
            || subrole == "AXSecureTextField"
    }

    var excluded: Bool {
        ["AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem", "AXWebArea"].contains(role)
    }

    var permitsTitle: Bool {
        !redacted && ["AXButton", "AXCheckBox", "AXRadioButton", "AXStaticText"].contains(role)
    }
}

struct ObservedNode: Codable {
    let ref: String
    let role: String
    let title: String?
    let redacted: Bool
    let children: [ObservedNode]
}

struct Observation: Codable {
    let session: String
    let generation: String
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let windowID: UInt32
    let nodes: [ObservedNode]
}

struct ObserverResponse: Codable {
    let version: Int
    let generation: String
    let observation: Observation?
    let error: String?
}

struct ObservationSession {
    let id = UUID().uuidString
    private(set) var generation = UUID().uuidString
    private var refs = Set<String>()

    mutating func beginAttempt() {
        generation = UUID().uuidString
        refs.removeAll(keepingCapacity: true)
    }

    mutating func makeRef() -> String {
        let ref = "\(id):\(generation):\(refs.count)"
        refs.insert(ref)
        return ref
    }

    func isCurrent(_ ref: String) -> Bool { refs.contains(ref) }

    mutating func discardRefs() { refs.removeAll(keepingCapacity: true) }
}

func isDeniedBrowser(_ bundleID: String) -> Bool {
    let id = bundleID.lowercased()
    let prefixes = ["com.apple.safari", "com.apple.safaritechnologypreview",
                    "com.google.chrome", "com.google.chromium", "org.chromium.chromium",
                    "org.mozilla.firefox", "org.mozilla.nightly", "org.mozilla.firefoxdeveloperedition",
                    "com.microsoft.edgemac", "com.brave.browser", "com.operasoftware.opera",
                    "company.thebrowser.browser", "app.zen-browser.zen", "com.vivaldi.vivaldi",
                    "com.duckduckgo.macos.browser", "com.kagi.kagimacos", "io.gitlab.librewolf-community"]
    return prefixes.contains { id == $0 || id.hasPrefix($0 + ".") }
}

func boundedTitle(_ value: String?) -> String? {
    guard let value else { return nil }
    var result = ""
    for scalar in value.unicodeScalars {
        if CharacterSet.controlCharacters.contains(scalar) { continue }
        let next = String(scalar)
        if result.utf8.count + next.utf8.count > 128 { break }
        result += next
    }
    return result.isEmpty ? nil : result
}

func encodeResponse(_ response: ObserverResponse) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(response)
    guard data.count <= 65_536 else { throw ObserverFailure.limitExceeded }
    return data
}
