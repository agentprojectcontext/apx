import Foundation

struct ObservationController {
    private(set) var session = ObservationSession()

    mutating func handle(_ input: Data?, observe: (ObserveRequest, inout ObservationSession) throws -> Observation) -> Data {
        session.beginAttempt()
        do {
            guard let input else { throw ObserverFailure.invalidRequest }
            let request = try ObserveRequest.parse(input)
            let result = try observe(request, &session)
            guard result.session == session.id, result.generation == session.generation,
                  result.pid == request.pid, result.launchIdentity == request.launchIdentity,
                  result.windowID == request.windowID else { throw ObserverFailure.identityMismatch }
            return try encodeResponse(ObserverResponse(version: 1, generation: session.generation,
                                                      observation: result, error: nil))
        } catch {
            session.discardRefs()
            let code = (error as? ObserverFailure ?? .unavailable).rawValue
            let response = ObserverResponse(version: 1, generation: session.generation, observation: nil, error: code)
            // All failure fields are fixed ASCII or UUID, independent of target content.
            return (try? encodeResponse(response)) ?? Data("{\"version\":1,\"error\":\"UNAVAILABLE\"}".utf8)
        }
    }
}

func handleObserverFrame(_ input: Data?, handle: (Data?) -> Data) -> Data {
    guard let input, let object = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
          object["requestID"] != nil || object["command"] != nil else { return handle(input) }
    guard input.count <= 8192, Set(object.keys) == Set(["requestID", "command"]),
          let requestID = object["requestID"] as? String, requestID.utf8.count == 36,
          UUID(uuidString: requestID) != nil, let command = object["command"] as? [String: Any],
          let commandData = try? JSONSerialization.data(withJSONObject: command, options: [.sortedKeys]) else {
        return handle(nil)
    }
    let result = handle(commandData)
    guard let value = try? JSONSerialization.jsonObject(with: result),
          let response = try? JSONSerialization.data(withJSONObject: ["requestID": requestID, "result": value],
                                                     options: [.sortedKeys]), response.count <= 65_536 else {
        // Retire state and refuse transport rather than publishing an oversized correlated response.
        return handle(nil)
    }
    return response
}

struct InputFramer {
    private var buffer = Data()
    private var oversized = false

    mutating func feed(_ bytes: Data, emit: (Data?) -> Void) {
        for byte in bytes {
            if byte == 10 {
                emit(oversized ? nil : buffer)
                buffer.removeAll(keepingCapacity: true)
                oversized = false
            } else if !oversized {
                if buffer.count == 8192 {
                    buffer.removeAll(keepingCapacity: true)
                    oversized = true
                } else { buffer.append(byte) }
            }
        }
    }

    mutating func finish(emit: (Data?) -> Void) {
        if oversized || !buffer.isEmpty { emit(nil) }
        buffer.removeAll(keepingCapacity: false)
        oversized = false
    }
}
