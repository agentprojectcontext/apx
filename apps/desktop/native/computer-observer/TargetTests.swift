import Foundation

enum TargetTests {
    static func run(_ test: (String, () throws -> Void) throws -> Void) throws {
        try test("live start identity comparison rejects PID reuse") {
            let expected = LaunchIdentity(seconds: 100, microseconds: 20)
            try validateProcessIdentity(expected: expected, actual: expected, bundleID: "com.acme.fixture")
            for actual in [LaunchIdentity(seconds: 101, microseconds: 20), LaunchIdentity(seconds: 100, microseconds: 21)] {
                try expectFailure(.identityMismatch) {
                    try validateProcessIdentity(expected: expected, actual: actual, bundleID: "com.acme.fixture")
                }
            }
        }
        try test("missing process identity and browser bundle fail closed") {
            let identity = LaunchIdentity(seconds: 100, microseconds: 20)
            try expectFailure(.identityMismatch) {
                try validateProcessIdentity(expected: identity, actual: identity, bundleID: nil)
            }
            try expectFailure(.browserDenied) {
                try validateProcessIdentity(expected: identity, actual: identity, bundleID: "com.google.Chrome")
            }
        }
        try test("exact window mapping does not depend on ordering") {
            let candidates: [(element: String, number: UInt32?)] = [("other", 8), ("chosen", 7)]
            let selected = try resolveExactWindow(candidates, requested: 7)
            let reordered = try resolveExactWindow(Array(candidates.reversed()), requested: 7)
            try expect(selected == "chosen" && reordered == selected, "Used ordering instead of ID")
        }
        try test("unknown missing duplicate and excess windows reject") {
            let cases: [[(element: String, number: UInt32?)]] = [[], [("unknown", nil)], [("wrong", 8)],
                [("first", 7), ("second", 7)], [("chosen", 7), ("unknown", nil)],
                (0...64).map { ("window", UInt32($0 + 1)) }]
            for candidates in cases {
                try expectFailure(.windowUnresolved) { _ = try resolveExactWindow(candidates, requested: 7) }
            }
        }
    }
}
