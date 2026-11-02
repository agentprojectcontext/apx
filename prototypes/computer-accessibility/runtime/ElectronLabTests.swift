import Foundation

final class RendererFixture: RendererNodeSource {
    var url: String? = "data:text/html,synthetic"
    var nestedURL: String? = "https://example.com/"
    var nested = false
    var reads: [String] = []
    func same(_ left: Int, _ right: Int) -> Bool { left == right }
    func metadata(_ element: Int) throws -> NodeMetadata {
        reads.append("metadata:\(element)")
        let roles = [1: "AXWebArea", 2: "AXButton", 3: "AXTextField", 4: "AXMenu", 5: "AXWebArea"]
        return NodeMetadata(role: roles[element] ?? "AXButton", subrole: nil)
    }
    func documentURL(_ element: Int) throws -> String? {
        reads.append("url:\(element)")
        return element == 1 ? url : nestedURL
    }
    func title(_ element: Int) throws -> String? {
        reads.append("title:\(element)")
        return element == 2 ? "Increment alpha" : "SYNTHETIC_PRIVATE_SENTINEL"
    }
    func children(_ element: Int) throws -> [Int] {
        reads.append("children:\(element)")
        return element == 1 ? (nested ? [2, 3, 4, 5] : [2, 3, 4]) : []
    }
}

struct LabTestFailure: Error {}
func check(_ condition: @autoclosure () -> Bool) throws { if !condition() { throw LabTestFailure() } }
func readFixture(_ fixture: RendererFixture, enabled: Bool = true,
                 onAllowedDocument: (() throws -> Void)? = nil) throws -> ObservedNode? {
    var session = ObservationSession()
    let budget = WorkBudget()
    if enabled {
        let source = SyntheticRendererSource(native: fixture, urls: ["data:text/html,synthetic"],
                                             onAllowedDocument: onAllowedDocument)
        var traversal = WindowTraversal(source: source, budget: budget)
        return try traversal.read(1, session: &session)
    }
    var traversal = WindowTraversal(source: fixture, budget: budget)
    return try traversal.read(1, session: &session)
}

@main
struct ElectronLabTests {
    static func main() throws {
        let baseline = RendererFixture()
        let baselineRoot = try readFixture(baseline, enabled: false)
        try check(baselineRoot == nil)
        try check(baseline.reads == ["metadata:1"])
        print("PASS default traversal still excludes web areas before URL or content reads")

        let allowed = RendererFixture()
        guard let root = try readFixture(allowed) else { throw LabTestFailure() }
        let text = String(decoding: try JSONEncoder().encode(root), as: UTF8.self)
        try check(text.contains("Increment alpha") && !text.contains("SYNTHETIC_PRIVATE_SENTINEL"))
        try check(!allowed.reads.contains("title:3") && !allowed.reads.contains("children:3"))
        try check(!allowed.reads.contains("title:4") && !allowed.reads.contains("children:4"))
        print("PASS exact synthetic URL enables buttons while input and menu sentinels remain unread")

        for url in [nil, "", "https://example.com/", "data:text/html,synthetic#changed", "data:text/html,other"] as [String?] {
            let denied = RendererFixture()
            denied.url = url
            do { _ = try readFixture(denied); throw LabTestFailure() }
            catch ObserverFailure.browserDenied { }
            try check(denied.reads == ["metadata:1", "url:1"])
        }
        print("PASS missing remote and changed URLs reject before title or descendant reads")

        let nested = RendererFixture()
        nested.nested = true
        do { _ = try readFixture(nested); throw LabTestFailure() }
        catch ObserverFailure.browserDenied { }
        try check(nested.reads.contains("url:5") && !nested.reads.contains("children:5") && !nested.reads.contains("title:5"))
        print("PASS unexpected nested renderer URL rejects without reading that subtree")
        let paused = RendererFixture()
        var callbackCalls = 0
        do {
            _ = try readFixture(paused, onAllowedDocument: {
                callbackCalls += 1
                try check(paused.reads == ["metadata:1", "url:1"])
                throw ObserverFailure.unavailable
            })
            throw LabTestFailure()
        } catch ObserverFailure.unavailable { }
        try check(callbackCalls == 1 && paused.reads == ["metadata:1", "url:1"])
        let beforeRefusal = RendererFixture()
        beforeRefusal.url = "https://example.com/"
        do {
            _ = try readFixture(beforeRefusal, onAllowedDocument: { callbackCalls += 1 })
            throw LabTestFailure()
        } catch ObserverFailure.browserDenied { }
        try check(callbackCalls == 1)
        print("PASS pause hook follows URL acceptance before content and never runs for a refused URL")
        print("5 laboratory policy tests passed; no native accessibility exercised")
    }
}
