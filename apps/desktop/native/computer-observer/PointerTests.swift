import Foundation
import CoreGraphics

private struct Failure: Error {}
private func require(_ value: @autoclosure () -> Bool) throws { if !value() { throw Failure() } }

private final class Backend: PointerActionBackend {
    var moves: [CGPoint] = []
    var validations = 0
    var presses = 0
    var actual = CGPoint(x: -800, y: 700)
    var resolveFailure = false
    var failValidation = false
    var failPress = false
    func resolve() throws -> Int {
        if resolveFailure { throw PointerActionFailure(reason: "web_content", uncertain: false) }
        return 7
    }
    func validate(_ target: Int) throws {
        validations += 1
        if failValidation { throw PointerActionFailure(reason: "destination_changed", uncertain: false) }
    }
    func move(_ point: CGPoint) { moves.append(point); actual = point }
    func press(_ target: Int) throws -> String {
        presses += 1
        if failPress { throw PointerActionFailure(reason: "press_uncertain", uncertain: true) }
        return "AXButton"
    }
}

@main
struct PointerTests {
    static func main() throws {
        var passed = 0
        func test(_ name: String, _ body: () throws -> Void) throws {
            try body(); passed += 1; print("PASS \(name)")
        }
        try test("accessible press does not move the physical pointer, even outside the target window") {
            let b = Backend()
            let original = b.actual
            let role = try performPointerAction(b, check: {})
            try require(role == "AXButton" && b.presses == 1 && b.validations == 1)
            try require(b.moves.isEmpty && b.actual == original)
        }
        try test("negative monitor coordinates do not move the physical pointer") {
            let b = Backend(); b.actual = CGPoint(x: -900, y: -100)
            _ = try performPointerAction(b, check: {})
            try require(b.actual == CGPoint(x: -900, y: -100) && b.moves.isEmpty)
        }
        try test("unsupported destination refuses before any effect") {
            let b = Backend(); b.resolveFailure = true
            do { _ = try performPointerAction(b, check: {}); throw Failure() }
            catch let failure as PointerActionFailure { try require(!failure.uncertain && failure.reason == "web_content") }
            try require(b.moves.isEmpty && b.presses == 0)
        }
        try test("destination replacement never presses or falls back") {
            let b = Backend(); b.failValidation = true
            do { _ = try performPointerAction(b, check: {}); throw Failure() }
            catch let failure as PointerActionFailure { try require(!failure.uncertain) }
            try require(b.presses == 0 && b.moves.isEmpty)
        }
        try test("uncertain AXPress is attempted exactly once, without physical click or retry") {
            let b = Backend(); b.failPress = true
            do { _ = try performPointerAction(b, check: {}); throw Failure() }
            catch let failure as PointerActionFailure { try require(failure.uncertain && failure.reason == "press_uncertain") }
            try require(b.presses == 1 && b.moves.isEmpty)
        }
        for cancelAt in 1...3 {
            try test("cancellation checkpoint \(cancelAt) never delivers AXPress") {
                let b = Backend(); var checks = 0
                do {
                    _ = try performPointerAction(b) {
                        checks += 1
                        if checks == cancelAt { throw PointerActionFailure(reason: "cancelled", uncertain: false) }
                    }
                    throw Failure()
                } catch let failure as PointerActionFailure { try require(failure.reason == "cancelled" && !failure.uncertain) }
                try require(b.presses == 0 && b.moves.isEmpty)
            }
        }
        try test("overlay duration is distance-aware and bounded from 300 to 700 milliseconds") {
            try require(pointerAnimationDuration(0) == 0.3)
            try require(pointerAnimationDuration(600) == 0.5)
            try require(pointerAnimationDuration(10000) == 0.7)
        }
        try test("curve control is perpendicular to travel at twenty percent distance") {
            try require(pointerCurveControl(from: .zero, to: CGPoint(x: 100, y: 0)) == CGPoint(x: 50, y: 20))
            try require(pointerCurveControl(from: .zero, to: CGPoint(x: 0, y: 100)) == CGPoint(x: -20, y: 50))
        }
        try test("curve handles negative coordinates and stationary destinations") {
            let point = CGPoint(x: -400, y: -200)
            try require(pointerCurveControl(from: point, to: point) == point)
            try require(pointerCurveControl(from: point, to: CGPoint(x: -300, y: -200)) == CGPoint(x: -350, y: -180))
        }
        for (role, subrole) in [("AXWebArea", nil), ("AXTextField", "AXSecureTextField"), ("AXSecureTextField", nil),
                                ("AXSearchField", nil), ("AXTextArea", nil), ("AXComboBox", nil),
                                ("AXTextField", ""), ("AXTextArea", ""), ("AXComboBox", ""), ("AXSearchField", ""),
                                ("AXTextField", " \n ")] as [(String, String?)] {
            try test("unsafe classification \(role) is refused before action selection") {
                do { try validatePointerClassification(role: role, subrole: subrole); throw Failure() }
                catch is PointerActionFailure {}
            }
        }
        try test("ordinary native buttons do not require a field subrole") {
            try validatePointerClassification(role: "AXButton", subrole: nil)
        }
        try test("overlay canvas uses the same top-left coordinate system as screen positions") {
            try require(pointerCanvas(frame: CGRect(x: 0, y: 0, width: 800, height: 600)).isFlipped)
        }
        print("\(passed) pointer behavior tests passed; native screen not exercised")
    }
}
