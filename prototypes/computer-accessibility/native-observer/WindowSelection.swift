import Foundation

struct ProcessTarget: Codable, Equatable {
    let pid: Int32
    let launchIdentity: LaunchIdentity
}

struct SelectionRequest: Decodable {
    let op: String
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let handle: String?

    static func parse(_ data: Data) throws -> SelectionRequest {
        guard data.count <= 8192,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let request = try? JSONDecoder().decode(Self.self, from: data),
              let launch = object["launchIdentity"] as? [String: Any],
              Set(launch.keys) == Set(["seconds", "microseconds"]),
              request.pid > 0, request.launchIdentity.seconds > 0,
              request.launchIdentity.microseconds < 1_000_000 else { throw ObserverFailure.invalidRequest }
        let keys = Set(object.keys)
        switch request.op {
        case "listWindows":
            guard keys == Set(["op", "pid", "launchIdentity"]) else { throw ObserverFailure.invalidRequest }
        case "observeSelected":
            guard keys == Set(["op", "pid", "launchIdentity", "handle"]),
                  let handle = request.handle, !handle.isEmpty, handle.utf8.count <= 256 else {
                throw ObserverFailure.invalidRequest
            }
        default: throw ObserverFailure.invalidRequest
        }
        return request
    }

    var target: ProcessTarget { ProcessTarget(pid: pid, launchIdentity: launchIdentity) }
}

protocol RetainedWindowBackend {
    associatedtype Element
    func validate(_ target: ProcessTarget, budget: WorkBudget) throws
    func windows(_ target: ProcessTarget, budget: WorkBudget) throws -> [Element]
    func same(_ left: Element, _ right: Element) -> Bool
    func validateWindow(_ window: Element, target: ProcessTarget, budget: WorkBudget) throws
    func windowTitle(_ window: Element, target: ProcessTarget, budget: WorkBudget) throws -> String?
    func read(_ window: Element, target: ProcessTarget, budget: WorkBudget,
              session: inout ObservationSession) throws -> ObservedNode
}

struct WindowDescriptor: Encodable {
    let handle: String
    let title: String?
    let ambiguous: Bool
}

struct WindowListing: Encodable {
    let session: String
    let generation: String
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let windows: [WindowDescriptor]
}

struct SelectedObservation: Encodable {
    let session: String
    let generation: String
    let pid: Int32
    let launchIdentity: LaunchIdentity
    let handle: String
    let association = "ax-only-no-capture-or-coordinates"
    let nodes: [ObservedNode]
}

private struct SelectionResponse: Encodable {
    let version = 1
    let generation: String
    var listing: WindowListing? = nil
    var selectedObservation: SelectedObservation? = nil
    var error: String? = nil
}

struct WindowSelectionController<Backend: RetainedWindowBackend> {
    let backend: Backend
    let makeBudget: () -> WorkBudget
    private var session = ObservationSession()
    private var target: ProcessTarget?
    private var retained: [String: Backend.Element] = [:]
    private var legacy = ObservationController()

    init(backend: Backend, makeBudget: @escaping () -> WorkBudget = { WorkBudget() }) {
        self.backend = backend
        self.makeBudget = makeBudget
    }

    private mutating func retire() {
        retained.removeAll()
        target = nil
    }

    mutating func handle(_ input: Data?, observe: (ObserveRequest, inout ObservationSession) throws -> Observation) -> Data {
        session.beginAttempt()
        do {
            guard let input else { throw ObserverFailure.invalidRequest }
            if (try? ObserveRequest.parse(input)) != nil {
                retire()
                return legacy.handle(input, observe: observe)
            }
            let request = try SelectionRequest.parse(input)
            let budget = makeBudget()
            var response = SelectionResponse(generation: session.generation)
            if request.op == "listWindows" {
                retire()
                try backend.validate(request.target, budget: budget)
                let windows = try backend.windows(request.target, budget: budget)
                try validateUnique(windows, budget: budget)
                var next: [String: Backend.Element] = [:]
                var candidates: [(handle: String, title: String?)] = []
                for window in windows {
                    try backend.validateWindow(window, target: request.target, budget: budget)
                    let rawTitle = try backend.windowTitle(window, target: request.target, budget: budget)
                    let trimmedTitle = boundedTitle(rawTitle)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    let title = trimmedTitle?.isEmpty == false ? trimmedTitle : nil
                    let handle = "\(session.id):\(session.generation):\(UUID().uuidString)"
                    next[handle] = window
                    candidates.append((handle, title))
                }
                let current = try backend.windows(request.target, budget: budget)
                try validateUnique(current, budget: budget)
                guard current.count == windows.count,
                      windows.allSatisfy({ window in current.contains(where: { backend.same($0, window) }) }) else {
                    throw ObserverFailure.windowUnresolved
                }
                try backend.validate(request.target, budget: budget)
                try budget.check()
                let descriptors = candidates.map { candidate in
                    WindowDescriptor(handle: candidate.handle, title: candidate.title,
                        ambiguous: candidate.title == nil || candidates.filter { $0.title == candidate.title }.count > 1)
                }
                response.listing = WindowListing(session: session.id, generation: session.generation,
                    pid: request.pid, launchIdentity: request.launchIdentity, windows: descriptors)
                let data = try encode(response)
                try budget.check()
                retained = next
                target = request.target
                return data
            }
            guard target == request.target, let handle = request.handle, let window = retained[handle] else {
                throw ObserverFailure.windowUnresolved
            }
            try backend.validate(request.target, budget: budget)
            try requirePresence(window, target: request.target, budget: budget)
            let root = try backend.read(window, target: request.target, budget: budget, session: &session)
            try requirePresence(window, target: request.target, budget: budget)
            try backend.validate(request.target, budget: budget)
            try budget.check()
            response.selectedObservation = SelectedObservation(session: session.id, generation: session.generation,
                pid: request.pid, launchIdentity: request.launchIdentity, handle: handle, nodes: [root])
            return try encode(response)
        } catch {
            retire()
            session.discardRefs()
            let response = SelectionResponse(generation: session.generation,
                error: (error as? ObserverFailure ?? .unavailable).rawValue)
            return (try? encode(response)) ?? Data("{\"version\":1,\"error\":\"UNAVAILABLE\"}".utf8)
        }
    }

    private func validateUnique(_ windows: [Backend.Element], budget: WorkBudget) throws {
        guard windows.count <= 64 else { throw ObserverFailure.limitExceeded }
        for (index, window) in windows.enumerated() {
            try budget.check()
            guard !windows.prefix(index).contains(where: { backend.same($0, window) }) else {
                throw ObserverFailure.windowUnresolved
            }
        }
    }

    private func requirePresence(_ window: Backend.Element, target: ProcessTarget, budget: WorkBudget) throws {
        let windows = try backend.windows(target, budget: budget)
        try validateUnique(windows, budget: budget)
        guard windows.filter({ backend.same($0, window) }).count == 1 else {
            throw ObserverFailure.windowUnresolved
        }
        try backend.validateWindow(window, target: target, budget: budget)
    }

    private func encode(_ response: SelectionResponse) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(response)
        guard data.count <= 65_536 else { throw ObserverFailure.limitExceeded }
        return data
    }
}
