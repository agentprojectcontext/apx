import Foundation

struct TestFailure: Error { let message: String }
func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw TestFailure(message: message) }
}
func expectFailure(_ code: ObserverFailure, _ body: () throws -> Void) throws {
    do { try body() } catch let error as ObserverFailure {
        try expect(error == code, "Wrong failure code")
        return
    }
    throw TestFailure(message: "Expected failure")
}
func object(_ data: Data) throws -> [String: Any] {
    guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw TestFailure(message: "Expected JSON object")
    }
    return result
}

@main
struct ObserverTests {
    static func main() throws {
        var passed = 0
        func test(_ name: String, _ body: () throws -> Void) throws {
            try body()
            passed += 1
            print("PASS \(name)")
        }
        try contractTests(test)
        try TargetTests.run(test)
        try SelectionTests.run(test)
        try treeTests(test)
        try protocolTests(test)
        try correlationTests(test)
        print("\(passed) behavioral tests passed; native AX runtime not exercised")
    }

    static func correlationTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("correlated frame binds exact ID and unwraps only the command") {
            let id = UUID().uuidString
            let command = try object(validInput)
            let frame = try JSONSerialization.data(withJSONObject: ["requestID": id, "command": command])
            var received: Data?
            let response = handleObserverFrame(frame) { input in
                received = input
                return Data("{\"version\":1,\"error\":\"UNAVAILABLE\"}".utf8)
            }
            let body = try object(response)
            try expect(body["requestID"] as? String == id && body.count == 2, "Unbound response")
            let result = body["result"] as? [String: Any]
            try expect(result?["error"] as? String == "UNAVAILABLE", "Changed result")
            try expect(received != nil, "Missing command")
            let request = try ObserveRequest.parse(received ?? Data())
            try expect(request.pid == 42 && request.windowID == 7, "Changed command")
        }
        try test("malformed correlation retires state without passing a command") {
            let id = UUID().uuidString
            let command = try object(validInput)
            let frames: [[String: Any]] = [
                ["requestID": "not-a-uuid", "command": command],
                ["requestID": id, "command": []],
                ["requestID": id, "command": command, "extra": true],
                ["requestID": id], ["command": command],
                ["requestID": NSNull(), "command": command]
            ]
            for frame in frames {
                var called = false
                var commandPassed = false
                let data = try JSONSerialization.data(withJSONObject: frame)
                let response = handleObserverFrame(data) { input in
                    called = true
                    commandPassed = input != nil
                    return Data("{\"version\":1,\"error\":\"INVALID_REQUEST\"}".utf8)
                }
                try expect(called && !commandPassed, "Malformed envelope reached command")
                let body = try object(response)
                try expect(body["requestID"] == nil, "Malformed correlation echoed")
            }
        }
        try test("correlation overhead refuses oversized output and retires state") {
            let frame = try JSONSerialization.data(withJSONObject: ["requestID": UUID().uuidString,
                                                                    "command": try object(validInput)])
            var retired = false
            let response = handleObserverFrame(frame) { input in
                if input == nil {
                    retired = true
                    return Data("{\"version\":1,\"error\":\"INVALID_REQUEST\"}".utf8)
                }
                return Data(("{\"version\":1,\"text\":\"" + String(repeating: "x", count: 65500) + "\"}").utf8)
            }
            try expect(retired && response.count <= 65536, "Oversize correlated success")
            let body = try object(response)
            try expect(body["result"] == nil, "Partial result published")
        }
        try test("unwrapped observational frames still use the same controller input") {
            var sameInput = false
            _ = handleObserverFrame(validInput) { input in sameInput = input == validInput; return Data() }
            try expect(sameInput, "Changed observational frame")
        }
    }

    static func contractTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("exact typed request") {
            let request = try ObserveRequest.parse(validInput)
            try expect(request.pid == 42 && request.windowID == 7, "Wrong target")
            try expect(request.launchIdentity == LaunchIdentity(seconds: 100, microseconds: 20), "Wrong identity")
        }
        try test("reject malformed and unknown keys without native call") {
            for input in [Data("invalid".utf8), Data("[]".utf8), Data("{\"extra\":1}".utf8), Data(repeating: 65, count: 8193)] {
                try expectFailure(.invalidRequest) { _ = try ObserveRequest.parse(input) }
            }
        }
        try test("reject invalid scalars and unsupported operations") {
            let base = String(decoding: validInput, as: UTF8.self)
            for input in [base.replacingOccurrences(of: "42", with: "0"),
                          base.replacingOccurrences(of: "42", with: "true"),
                          base.replacingOccurrences(of: "42", with: "42.5"),
                          base.replacingOccurrences(of: "20", with: "1000000"),
                          base.replacingOccurrences(of: "observe", with: "press"),
                          base.replacingOccurrences(of: "\"windowID\":7", with: "\"windowID\":4294967296"),
                          base.replacingOccurrences(of: "\"seconds\":100", with: "\"seconds\":-1"),
                          base.replacingOccurrences(of: "\"seconds\":100", with: "\"extra\":0,\"seconds\":100")] {
                try expectFailure(.invalidRequest) { _ = try ObserveRequest.parse(Data(input.utf8)) }
            }
        }
        try test("browser deny families and known limitation") {
            try expect(isDeniedBrowser("com.apple.Safari"), "Safari accepted")
            try expect(isDeniedBrowser("com.google.Chrome.canary"), "Chrome accepted")
            try expect(isDeniedBrowser("org.mozilla.firefox"), "Firefox accepted")
            try expect(isDeniedBrowser("com.apple.SafariTechnologyPreview"), "Safari preview accepted")
            try expect(isDeniedBrowser("org.mozilla.nightly"), "Nightly accepted")
            try expect(!isDeniedBrowser("com.acme.fixture"), "Fixture denied")
            try expect(!isDeniedBrowser("com.acme.unknown-browser"), "List is not an exhaustive browser detector")
        }
        try test("title UTF8 and control cap") {
            let title = boundedTitle(String(repeating: "é", count: 100) + "\n\u{0}")
            try expect(title?.utf8.count == 128, "Wrong UTF8 cap")
            try expect(boundedTitle("\n\u{0}") == nil, "Control data survived")
        }
        try test("ref lifecycle foreign session and failed generation") {
            var first = ObservationSession()
            var second = ObservationSession()
            first.beginAttempt()
            let ref = first.makeRef()
            _ = second.makeRef()
            try expect(first.isCurrent(ref) && !second.isCurrent(ref), "Foreign ref accepted")
            first.beginAttempt()
            try expect(!first.isCurrent(ref), "Stale ref accepted")
            let next = first.makeRef()
            first.discardRefs()
            try expect(!first.isCurrent(next), "Failed observation retained refs")
        }
        try test("output byte cap") {
            let huge = Observation(session: "s", generation: "g", pid: 42,
                                   launchIdentity: .init(seconds: 100, microseconds: 20), windowID: 7,
                                   nodes: [.init(ref: "r", role: "AXWindow", title: String(repeating: "x", count: 65536),
                                                 redacted: false, children: [])])
            try expectFailure(.limitExceeded) {
                _ = try encodeResponse(.init(version: 1, generation: "g", observation: huge, error: nil))
            }
        }
    }

    static func treeTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("secure subtree filtered before title and children reads") {
            let source = FixtureSource([0: .init(role: "AXWindow", children: [1, 3]),
                                       1: .init(role: "AXTextField", subrole: "AXSecureTextField", title: "PRIVATE_MARKER", children: [2]),
                                       2: .init(role: "AXStaticText", title: "PRIVATE_MARKER"),
                                       3: .init(role: "AXButton", title: "Continue")])
            var session = ObservationSession()
            var reader = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
            let result = try reader.read(0, session: &session)
            try expect(!source.titleReads.contains(1) && !source.childrenReads.contains(1), "Secure data requested")
            try expect(result?.children.first?.redacted == true, "Secure node not redacted")
            let data = try JSONEncoder().encode(result)
            try expect(!String(decoding: data, as: UTF8.self).contains("PRIVATE_MARKER"), "Private marker leaked")
            try expect(result?.children.last?.title == "Continue", "Public label missing")
        }
        try test("editable fields fail private even with missing secure subrole") {
            for role in ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"] {
                let source = FixtureSource([0: .init(role: role, title: "PRIVATE_MARKER", children: [1])])
                var session = ObservationSession()
                var reader = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
                let result = try reader.read(0, session: &session)
                try expect(result?.redacted == true && source.titleReads.isEmpty && source.childrenReads.isEmpty,
                           "Editable metadata read")
            }
        }
        try test("menu and web area excluded before descendant reads") {
            for role in ["AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem", "AXWebArea"] {
                let source = FixtureSource([0: .init(role: role, title: "PRIVATE_MARKER", children: [1])])
                var session = ObservationSession()
                var reader = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
                let result = try reader.read(0, session: &session)
                try expect(result == nil && source.titleReads.isEmpty && source.childrenReads.isEmpty, "Excluded data read")
            }
        }
        try test("arbitrary roles never serialized raw") {
            let source = FixtureSource([0: .init(role: "PRIVATE_MARKER", title: "PRIVATE_MARKER")])
            var session = ObservationSession()
            var reader = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
            let result = try reader.read(0, session: &session)
            try expect(result?.role == "AXUnknown" && result?.title == nil, "Raw role leaked")
        }
        try test("cycle rejection") {
            let source = FixtureSource([0: .init(role: "AXWindow", children: [0])])
            var session = ObservationSession()
            var reader = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
            try expectFailure(.unsupported) { _ = try reader.read(0, session: &session) }
        }
        try test("depth bound") {
            var nodes: [Int: FixtureSource.Node] = [:]
            for index in 0...17 { nodes[index] = .init(role: "AXGroup", children: index < 17 ? [index + 1] : []) }
            var reader = WindowTraversal(source: FixtureSource(nodes), budget: WorkBudget(now: { 0 }))
            var session = ObservationSession()
            try expectFailure(.limitExceeded) { _ = try reader.read(0, session: &session) }
        }
        try test("node bound") {
            var nodes: [Int: FixtureSource.Node] = [0: .init(role: "AXWindow", children: Array(1...256))]
            for index in 1...256 { nodes[index] = .init(role: "AXButton") }
            var reader = WindowTraversal(source: FixtureSource(nodes), budget: WorkBudget(now: { 0 }))
            var session = ObservationSession()
            try expectFailure(.limitExceeded) { _ = try reader.read(0, session: &session) }
        }
        try test("injected deadline without wall clock") {
            var now: UInt64 = 0
            let budget = WorkBudget(duration: 10, now: { now })
            try budget.check()
            now = 10
            try expectFailure(.deadlineExceeded) { try budget.check() }
        }
    }

    static func protocolTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("successful controller response with scoped refs") {
            var controller = ObservationController()
            let response = try object(controller.handle(validInput, observe: fixtureObserve))
            try expect(response["observation"] != nil && response["error"] == nil, "Observation failed")
            let result = response["observation"] as? [String: Any]
            try expect(result?["generation"] as? String == controller.session.generation, "Wrong generation")
        }
        try test("invalid request invalidates prior generation without backend") {
            var controller = ObservationController()
            _ = controller.handle(validInput, observe: fixtureObserve)
            let old = controller.session.generation
            var called = false
            let response = try object(controller.handle(Data("{}".utf8)) { _, _ in called = true; throw ObserverFailure.unsupported })
            try expect(response["error"] as? String == "INVALID_REQUEST" && !called, "Invalid request reached backend")
            try expect(old != controller.session.generation, "Failed attempt retained generation")
        }
        try test("native failure is sanitized and refs discarded") {
            var controller = ObservationController()
            var ref = ""
            let response = try object(controller.handle(validInput) { _, session in
                ref = session.makeRef()
                throw TestFailure(message: "PRIVATE_MARKER")
            })
            try expect(response["error"] as? String == "UNAVAILABLE" && response["observation"] == nil, "Raw error response")
            try expect(!controller.session.isCurrent(ref), "Error refs retained")
        }
        try test("serialization limit returns no tree and discards refs") {
            var controller = ObservationController()
            var ref = ""
            let response = try object(controller.handle(validInput) { request, session in
                ref = session.makeRef()
                let node = ObservedNode(ref: ref, role: "AXButton", title: String(repeating: "x", count: 65536),
                                        redacted: false, children: [])
                return Observation(session: session.id, generation: session.generation, pid: request.pid,
                                   launchIdentity: request.launchIdentity, windowID: request.windowID, nodes: [node])
            })
            try expect(response["error"] as? String == "LIMIT_EXCEEDED" && response["observation"] == nil, "Partial tree emitted")
            try expect(!controller.session.isCurrent(ref), "Oversize refs retained")
        }
        try test("reject backend identity mismatch") {
            var controller = ObservationController()
            let response = try object(controller.handle(validInput) { request, session in
                Observation(session: session.id, generation: session.generation, pid: request.pid,
                            launchIdentity: request.launchIdentity, windowID: 8, nodes: [])
            })
            try expect(response["error"] as? String == "IDENTITY_MISMATCH", "Wrong identity accepted")
        }
        try test("JSONL fragmentation oversize recovery and EOF") {
            var framer = InputFramer()
            var results: [Data?] = []
            framer.feed(Data("ab".utf8)) { results.append($0) }
            framer.feed(Data("c\n".utf8)) { results.append($0) }
            framer.feed(Data(repeating: 65, count: 8193)) { results.append($0) }
            framer.feed(Data("\nok\npartial".utf8)) { results.append($0) }
            framer.finish { results.append($0) }
            try expect(results.count == 4, "Wrong frame count")
            try expect(results[0] == Data("abc".utf8) && results[1] == nil && results[2] == Data("ok".utf8) && results[3] == nil,
                       "Wrong framing")
        }
    }
}
