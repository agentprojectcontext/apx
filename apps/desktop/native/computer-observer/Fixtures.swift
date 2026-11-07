import Foundation

final class FixtureSource: WindowNodeSource {
    typealias Element = Int
    struct Node {
        let role: String
        var subrole: String? = nil
        var title: String? = nil
        var children: [Int] = []
    }
    let nodes: [Int: Node]
    private(set) var titleReads: [Int] = []
    private(set) var childrenReads: [Int] = []

    init(_ nodes: [Int: Node]) { self.nodes = nodes }
    func same(_ left: Int, _ right: Int) -> Bool { left == right }
    func metadata(_ element: Int) throws -> NodeMetadata {
        guard let node = nodes[element] else { throw ObserverFailure.unavailable }
        return NodeMetadata(role: node.role, subrole: node.subrole)
    }
    func title(_ element: Int) throws -> String? {
        titleReads.append(element)
        return nodes[element]?.title
    }
    func children(_ element: Int) throws -> [Int] {
        childrenReads.append(element)
        return nodes[element]?.children ?? []
    }
}

let validInput = Data("{\"op\":\"observe\",\"pid\":42,\"launchIdentity\":{\"seconds\":100,\"microseconds\":20},\"windowID\":7}".utf8)

func fixtureObserve(_ request: ObserveRequest, session: inout ObservationSession) throws -> Observation {
    let source = FixtureSource([0: .init(role: "AXWindow", children: [1]),
                                1: .init(role: "AXButton", title: "Continue")])
    var traversal = WindowTraversal(source: source, budget: WorkBudget(now: { 0 }))
    let root = try traversal.read(0, session: &session)
    return Observation(session: session.id, generation: session.generation, pid: request.pid,
                       launchIdentity: request.launchIdentity, windowID: request.windowID,
                       nodes: root.map { [$0] } ?? [])
}
