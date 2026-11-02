import Foundation

final class SelectionFixture: RetainedWindowBackend {
    var current = [1, 2]
    var identity = LaunchIdentity(seconds: 100, microseconds: 20)
    var bundleID = "com.acme.fixture"
    var events: [String] = []
    var onRead: (() -> Void)?
    var onValidate: (() -> Void)?
    var onWindows: (() -> Void)?
    var failList = false
    var privateTitle = "HOMONYMOUS_PRIVATE_MARKER"
    var source: FixtureSource?
    var titles = [1: "Acme window", 2: "Acme window"]
    var onTitle: (() throws -> Void)?

    func same(_ left: Int, _ right: Int) -> Bool { left == right }
    func validate(_ target: ProcessTarget, budget: WorkBudget) throws {
        events.append("process")
        try budget.check()
        try validateProcessIdentity(expected: target.launchIdentity, actual: identity, bundleID: bundleID)
        guard target.pid == 42 else { throw ObserverFailure.identityMismatch }
        onValidate?()
    }
    func windows(_ target: ProcessTarget, budget: WorkBudget) throws -> [Int] {
        events.append("windows")
        try budget.check()
        if failList { throw TestFailure(message: "PRIVATE_MARKER") }
        onWindows?()
        return current
    }
    func validateWindow(_ window: Int, target: ProcessTarget, budget: WorkBudget) throws {
        events.append("role:\(window)")
        try budget.check()
    }
    func windowTitle(_ window: Int, target: ProcessTarget, budget: WorkBudget) throws -> String? {
        events.append("title:\(window)")
        try budget.check()
        try onTitle?()
        return titles[window]
    }
    func read(_ window: Int, target: ProcessTarget, budget: WorkBudget,
              session: inout ObservationSession) throws -> ObservedNode {
        events.append("read:\(window)")
        let fixture = FixtureSource([window: .init(role: "AXWindow", title: privateTitle, children: [10, 20, 30]),
            10: .init(role: "AXButton", title: "Continue"),
            20: .init(role: "AXSecureTextField", title: "PRIVATE_MARKER", children: [40]),
            30: .init(role: "AXWebArea", title: "PRIVATE_MARKER", children: [40]),
            40: .init(role: "AXStaticText", title: "PRIVATE_MARKER")])
        source = fixture
        var traversal = WindowTraversal(source: fixture, budget: budget)
        guard let root = try traversal.read(window, session: &session) else { throw ObserverFailure.unavailable }
        onRead?()
        return root
    }
}

private let listInput = Data("{\"op\":\"listWindows\",\"pid\":42,\"launchIdentity\":{\"seconds\":100,\"microseconds\":20}}".utf8)

private func selectedInput(_ handle: String, pid: Int32 = 42) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["op": "observeSelected", "pid": pid,
        "launchIdentity": ["seconds": 100, "microseconds": 20], "handle": handle])
}

private func listing(_ controller: inout WindowSelectionController<SelectionFixture>) throws -> [String] {
    let response = try object(controller.handle(listInput, observe: fixtureObserve))
    guard let listing = response["listing"] as? [String: Any], let windows = listing["windows"] as? [[String: Any]] else {
        throw TestFailure(message: "Listing failed")
    }
    let handles = windows.compactMap { $0["handle"] as? String }
    try expect(handles.count == windows.count, "Missing descriptor handle")
    return handles
}

private func select(_ controller: inout WindowSelectionController<SelectionFixture>, _ handle: String) throws -> [String: Any] {
    try object(controller.handle(try selectedInput(handle), observe: fixtureObserve))
}

private func fixtureController(_ backend: SelectionFixture) -> WindowSelectionController<SelectionFixture> {
    WindowSelectionController(backend: backend, makeBudget: { WorkBudget(now: { 0 }) })
}

enum SelectionTests {
    static func run(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("listing emits opaque distinct handles and reads only root titles") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            try expect(handles.count == 2 && Set(handles).count == 2, "Handles not distinct")
            try expect(backend.events == ["process", "windows", "role:1", "title:1", "role:2", "title:2", "windows", "process"],
                       "Listing read beyond root titles")
            try expect(backend.source == nil && !handles.joined().contains(backend.privateTitle), "Title leaked")
        }
        try test("selection survives reordering and homonymous titles are not identity") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            backend.current = [2, 1]
            backend.events = []
            let result = try select(&controller, handles[0])
            try expect(result["selectedObservation"] != nil && result["error"] == nil, "Selection failed")
            try expect(backend.events == ["process", "windows", "role:1", "read:1", "windows", "role:1", "process"],
                       "Revalidation order or selected identity wrong")
            try expect(backend.source?.titleReads == [10], "Window or sensitive title read")
            try expect(backend.source?.childrenReads == [1, 10], "Sensitive descendants requested")
            let encoded = try JSONSerialization.data(withJSONObject: result)
            try expect(!String(decoding: encoded, as: UTF8.self).contains("PRIVATE_MARKER"), "Private content leaked")
        }
        try test("selected result cannot claim capture CG or coordinates association") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            let result = try select(&controller, handles[0])
            guard let observation = result["selectedObservation"] as? [String: Any] else {
                throw TestFailure(message: "No selected result")
            }
            try expect(observation["association"] as? String == "ax-only-no-capture-or-coordinates", "Missing separation")
            try expect(observation["windowID"] == nil && observation["coordinates"] == nil && result["observation"] == nil,
                       "Legacy association leaked")
            for key in ["windowID", "captureID", "coordinates", "association"] {
                var request = try object(selectedInput(handles[0]))
                request[key] = "claimed"
                let response = try object(controller.handle(try JSONSerialization.data(withJSONObject: request), observe: fixtureObserve))
                try expect(response["error"] as? String == "INVALID_REQUEST", "Capture claim accepted")
            }
        }
        try test("disappeared replaced and ambiguous window fail before traversal") {
            for windows in [[2], [2, 3], [1, 1]] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let handles = try listing(&controller)
                backend.current = windows
                let response = try select(&controller, handles[0])
                try expect(response["error"] as? String == "WINDOW_UNRESOLVED", "Replacement accepted")
                try expect(backend.source == nil, "Read wrong window")
            }
        }
        try test("close or replacement during traversal returns no partial tree") {
            for windows in [[2], [2, 3], [1, 1]] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let handles = try listing(&controller)
                backend.onRead = { backend.current = windows }
                let response = try select(&controller, handles[0])
                try expect(response["error"] as? String == "WINDOW_UNRESOLVED" && response["selectedObservation"] == nil,
                           "Postread disappearance accepted")
            }
        }
        try descriptorTests(test)
        try lifecycleTests(test)
        try rejectionTests(test)
    }

    static func descriptorTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("duplicate and missing titles are ambiguous without rejecting distinct retained windows") {
            for titles in [[1: "Same", 2: "Same"], [1: "  \n", 2: "\t"], [Int: String]()] {
                let backend = SelectionFixture()
                backend.titles = titles
                var controller = fixtureController(backend)
                let response = try object(controller.handle(listInput, observe: fixtureObserve))
                let listed = response["listing"] as? [String: Any]
                let windows = listed?["windows"] as? [[String: Any]] ?? []
                try expect(windows.count == 2 && windows.allSatisfy { $0["ambiguous"] as? Bool == true },
                           "Ambiguity hidden or listing rejected")
                let handles = windows.compactMap { $0["handle"] as? String }
                try expect(Set(handles).count == 2 && backend.source == nil, "Identity inferred or contents traversed")
                try expect(listed?["selected"] == nil && response["selectedObservation"] == nil, "Auto-selected window")
                if titles.values.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                    try expect(windows.allSatisfy { $0["title"] == nil }, "Invented title")
                }
            }
        }
        try test("distinct title descriptors do not replace opaque handle selection") {
            let backend = SelectionFixture()
            backend.titles = [1: "Acme alpha", 2: "Acme beta"]
            var controller = fixtureController(backend)
            let response = try object(controller.handle(listInput, observe: fixtureObserve))
            let listed = response["listing"] as? [String: Any]
            let windows = listed?["windows"] as? [[String: Any]] ?? []
            try expect(windows.compactMap { $0["title"] as? String } == ["Acme alpha", "Acme beta"], "Titles missing")
            try expect(windows.allSatisfy { $0["ambiguous"] as? Bool == false }, "Distinct titles ambiguous")
            backend.events = []
            let failure = try select(&controller, "Acme alpha")
            try expect(failure["error"] as? String == "WINDOW_UNRESOLVED" && backend.events.isEmpty,
                       "Title used as identity")
        }
        try test("titles are bounded and ambiguity uses the sanitized display title") {
            let backend = SelectionFixture()
            backend.titles = [1: String(repeating: "é", count: 90) + "alpha",
                              2: "\u{0000}" + String(repeating: "é", count: 90) + "beta\n"]
            var controller = fixtureController(backend)
            let response = try object(controller.handle(listInput, observe: fixtureObserve))
            let listed = response["listing"] as? [String: Any]
            let windows = listed?["windows"] as? [[String: Any]] ?? []
            let titles = windows.compactMap { $0["title"] as? String }
            try expect(titles.count == 2 && titles.allSatisfy { $0.utf8.count == 128 }, "Title byte bound incorrect")
            try expect(titles.allSatisfy { !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) },
                       "Control characters exposed")
            try expect(windows.allSatisfy { $0["ambiguous"] as? Bool == true }, "Truncation collision hidden")
        }
        try test("window membership changes during title reads retire the whole listing") {
            for current in [[1], [1, 3], [1, 2, 3], [1, 1]] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let handles = try listing(&controller)
                backend.onTitle = { backend.current = current }
                let response = try object(controller.handle(listInput, observe: fixtureObserve))
                try expect(response["error"] as? String == "WINDOW_UNRESOLVED" && response["listing"] == nil,
                           "Published a listing after window membership changed")
                backend.onTitle = nil
                let stale = try select(&controller, handles[0])
                try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Changed listing kept old handles")
            }
        }
        try test("title reads may reorder windows without changing retained identity") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            backend.onTitle = { backend.current = [2, 1] }
            let handles = try listing(&controller)
            try expect(handles.count == 2, "Reordering rejected unchanged membership")
        }
        try test("failed title read is sanitized and retires the prior listing") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            backend.onTitle = { throw TestFailure(message: "PRIVATE_MARKER") }
            let response = controller.handle(listInput, observe: fixtureObserve)
            let failure = try object(response)
            try expect(failure["error"] as? String == "UNAVAILABLE" && failure["listing"] == nil, "Partial title listing")
            try expect(!String(decoding: response, as: UTF8.self).contains("PRIVATE_MARKER"), "Native error exposed")
            backend.onTitle = nil
            let stale = try select(&controller, handles[0])
            try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Failed title read kept handles")
        }
    }

    static func lifecycleTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("process instance revalidated before and after traversal") {
            for afterRead in [false, true] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let handles = try listing(&controller)
                let change = { backend.identity = LaunchIdentity(seconds: 101, microseconds: 20) }
                if afterRead { backend.onRead = change } else { change() }
                let response = try select(&controller, handles[0])
                try expect(response["error"] as? String == "IDENTITY_MISMATCH" && response["selectedObservation"] == nil,
                           "Process replacement accepted")
                try expect(afterRead || backend.source == nil, "Read before process validation")
            }
        }
        try test("foreign session helper restart and generation handles reject") {
            let backend = SelectionFixture()
            var first = fixtureController(backend)
            let handles = try listing(&first)
            var second = fixtureController(backend)
            _ = try listing(&second)
            let foreign = try select(&second, handles[0])
            try expect(foreign["error"] as? String == "WINDOW_UNRESOLVED", "Foreign helper accepted handle")
            _ = try listing(&first)
            let stale = try select(&first, handles[0])
            try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Retired generation accepted")
            var restarted = fixtureController(backend)
            let restart = try select(&restarted, handles[0])
            try expect(restart["error"] as? String == "WINDOW_UNRESOLVED", "Restart accepted handle")
        }
        try test("failed or malformed listing retires previous handles") {
            for malformed in [false, true] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let handles = try listing(&controller)
                backend.failList = true
                let input = malformed ? Data("{\"op\":\"listWindows\"}".utf8) : listInput
                let failure = try object(controller.handle(input, observe: fixtureObserve))
                try expect(failure["listing"] == nil && failure["error"] as? String == (malformed ? "INVALID_REQUEST" : "UNAVAILABLE"),
                           "Failed listing not sanitized")
                backend.failList = false
                let stale = try select(&controller, handles[0])
                try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Failed listing retained handle")
            }
        }
        try test("wrong target and unknown handle fail closed without backend reads") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            backend.events = []
            let response = try object(controller.handle(try selectedInput(handles[0], pid: 43), observe: fixtureObserve))
            try expect(response["error"] as? String == "WINDOW_UNRESOLVED" && backend.events.isEmpty, "Foreign PID read")
            let unknown = try select(&controller, "unknown")
            try expect(unknown["error"] as? String == "WINDOW_UNRESOLVED" && backend.events.isEmpty, "Unknown handle read")
        }
    }

    static func rejectionTests(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("empty listing does not invent a selected window") {
            let backend = SelectionFixture()
            backend.current = []
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            try expect(handles.isEmpty && backend.source == nil, "Empty list selected a window")
            let response = try select(&controller, "invented")
            try expect(response["error"] as? String == "WINDOW_UNRESOLVED", "Invented window accepted")
        }
        try test("listing deadline after validation publishes no handles") {
            let backend = SelectionFixture()
            var tick: UInt64 = 0
            var controller = WindowSelectionController(backend: backend,
                makeBudget: { WorkBudget(duration: 10, now: { tick }) })
            let handles = try listing(&controller)
            backend.onValidate = { tick = 11 }
            let response = try object(controller.handle(listInput, observe: fixtureObserve))
            try expect(response["error"] as? String == "DEADLINE_EXCEEDED" && response["listing"] == nil,
                       "Expired listing published")
            let stale = try select(&controller, handles[0])
            try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Expired listing retained old handles")
        }
        try test("listing rejects duplicate excess browser and changed process") {
            for mode in 0...3 {
                let backend = SelectionFixture()
                if mode == 0 { backend.current = [1, 1] }
                if mode == 1 { backend.current = Array(1...65) }
                if mode == 2 { backend.bundleID = "com.apple.Safari" }
                if mode == 3 { backend.onWindows = { backend.identity = .init(seconds: 101, microseconds: 20) } }
                var controller = fixtureController(backend)
                let result = try object(controller.handle(listInput, observe: fixtureObserve))
                let expected = ["WINDOW_UNRESOLVED", "LIMIT_EXCEEDED", "BROWSER_DENIED", "IDENTITY_MISMATCH"][mode]
                try expect(result["error"] as? String == expected && result["listing"] == nil, "Unsafe listing")
                try expect(backend.source == nil, "Listing traversed")
            }
        }
        try test("selected injected deadline sanitized failure retires handles") {
            let backend = SelectionFixture()
            var tick: UInt64 = 0
            var controller = WindowSelectionController(backend: backend,
                makeBudget: { WorkBudget(duration: 10, now: { tick }) })
            let handles = try listing(&controller)
            backend.onRead = { tick = 11 }
            let response = try select(&controller, handles[0])
            try expect(response["error"] as? String == "DEADLINE_EXCEEDED" && response["selectedObservation"] == nil,
                       "Deadline not enforced")
            let stale = try select(&controller, handles[0])
            try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Deadline retained selection")
        }
        try test("legacy strict observation remains separate and retires selections") {
            let backend = SelectionFixture()
            var controller = fixtureController(backend)
            let handles = try listing(&controller)
            let response = try object(controller.handle(validInput, observe: fixtureObserve))
            try expect(response["observation"] != nil && response["selectedObservation"] == nil, "Legacy semantics changed")
            let stale = try select(&controller, handles[0])
            try expect(stale["error"] as? String == "WINDOW_UNRESOLVED", "Legacy retained selection")
        }
        try test("unsupported operations and unknown list fields do not reach backend") {
            for input in ["{\"op\":\"press\"}",
                          String(decoding: listInput, as: UTF8.self).replacingOccurrences(of: "\"pid\":42", with: "\"captureID\":1,\"pid\":42")] {
                let backend = SelectionFixture()
                var controller = fixtureController(backend)
                let response = try object(controller.handle(Data(input.utf8), observe: fixtureObserve))
                try expect(response["error"] as? String == "INVALID_REQUEST" && backend.events.isEmpty, "Unexpected backend call")
            }
        }
    }
}
