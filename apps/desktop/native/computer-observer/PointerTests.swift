import Foundation
import CoreGraphics
import QuartzCore

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
        try test("travel accelerates and settles in scale without moving the destination") {
            let start = CGPoint(x: -100, y: 40)
            let end = CGPoint(x: 500, y: 40)
            let animation = pointerTravelAnimation(from: start, to: end)
            try require(animation.duration == 0.5)
            guard let children = animation.animations, children.count == 2,
                  let travel = children[0] as? CAKeyframeAnimation,
                  let settle = children[1] as? CAKeyframeAnimation,
                  let path = travel.path, let timing = travel.timingFunction,
                  let scales = settle.values as? [Double] else { throw Failure() }
            try require(path.currentPoint == end && travel.keyPath == "position")
            try require(settle.keyPath == "transform.scale" && scales.first == 1 && scales.last == 1)
            try require(scales.allSatisfy { $0 >= 0.96 && $0 <= 1.035 } && scales.contains { $0 > 1 })
            try require(travel.duration == animation.duration && settle.duration == animation.duration)
            var control: [Float] = [0, 0]
            timing.getControlPoint(at: 1, values: &control)
            try require(abs(control[0] - 0.65) < 0.001 && control[1] == 0)
            timing.getControlPoint(at: 2, values: &control)
            try require(abs(control[0] - 0.35) < 0.001 && control[1] == 1)
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
        try test("a point on a side screen lands inside that screen's overlay, not the main one's") {
            let main = CGRect(x: 0, y: 0, width: 1920, height: 1080)
            let side = CGRect(x: 1920, y: 0, width: 1920, height: 1080)
            let point = CGPoint(x: 2500, y: 500)
            let onSide = pointerScreenPoint(point, screen: side, mainHeight: main.maxY)
            let onMain = pointerScreenPoint(point, screen: main, mainHeight: main.maxY)
            try require(CGRect(origin: .zero, size: side.size).contains(onSide))
            try require(!CGRect(origin: .zero, size: main.size).contains(onMain))
            try require(onMain.x - onSide.x == side.minX - main.minX && onMain.y == onSide.y)
        }
        try test("a screen above the main one maps a negative screen point by its own top edge") {
            let above = CGRect(x: -300, y: 1080, width: 1920, height: 1080)
            let point = pointerScreenPoint(CGPoint(x: 100, y: -500), screen: above, mainHeight: 1080)
            try require(abs(point.x - 397) < 0.001 && abs(point.y - 577.48) < 0.001)
        }
        print("\(passed) pointer behavior tests passed; native screen not exercised")
    }
}
