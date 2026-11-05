import AppKit
import QuartzCore

func pointerAnimationDuration(_ distance: Double) -> Double {
    min(0.700, max(0.300, distance / 1200))
}

func pointerCurveControl(from start: CGPoint, to end: CGPoint) -> CGPoint {
    CGPoint(x: (start.x + end.x) / 2 - (end.y - start.y) * 0.20,
            y: (start.y + end.y) / 2 + (end.x - start.x) * 0.20)
}

func pointerTravelAnimation(from start: CGPoint, to end: CGPoint) -> CAAnimationGroup {
    let path = CGMutablePath()
    path.move(to: start)
    path.addQuadCurve(to: end, control: pointerCurveControl(from: start, to: end))
    let travel = CAKeyframeAnimation(keyPath: "position")
    travel.path = path
    travel.calculationMode = .linear
    travel.timingFunction = CAMediaTimingFunction(controlPoints: 0.65, 0, 0.35, 1)
    let settle = CAKeyframeAnimation(keyPath: "transform.scale")
    settle.values = [1.0, 0.96, 1.035, 0.99, 1.0]
    settle.keyTimes = [0, 0.18, 0.78, 0.9, 1]
    settle.timingFunctions = (0..<4).map { _ in CAMediaTimingFunction(name: .easeInEaseOut) }
    let group = CAAnimationGroup()
    group.duration = pointerAnimationDuration(hypot(end.x - start.x, end.y - start.y))
    travel.duration = group.duration
    settle.duration = group.duration
    group.animations = [travel, settle]
    return group
}

private final class PointerWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

private final class PointerCanvas: NSView {
    override var isFlipped: Bool { true }
}

func pointerCanvas(frame: CGRect) -> NSView { PointerCanvas(frame: frame) }

private let pointerGreen = NSColor(calibratedRed: 22.0 / 255, green: 176.0 / 255, blue: 131.0 / 255, alpha: 1).cgColor

private func pointerShape(_ path: CGPath, width: CGFloat) -> CAShapeLayer {
    let layer = CAShapeLayer()
    layer.path = path
    layer.fillColor = NSColor.white.cgColor
    layer.strokeColor = pointerGreen
    layer.lineWidth = width
    layer.lineJoin = .round
    layer.shadowColor = pointerGreen
    layer.shadowOpacity = 0.7
    layer.shadowRadius = 2.5
    layer.shadowOffset = .zero
    return layer
}

private func sparkPath(x: CGFloat, y: CGFloat, small: CGFloat, large: CGFloat) -> CGPath {
    let path = CGMutablePath()
    let points = [CGPoint(x: x, y: y - large), CGPoint(x: x + small, y: y - small),
                  CGPoint(x: x + large, y: y), CGPoint(x: x + small, y: y + small),
                  CGPoint(x: x, y: y + large), CGPoint(x: x - small, y: y + small),
                  CGPoint(x: x - large, y: y), CGPoint(x: x - small, y: y - small)]
    path.addLines(between: points)
    path.closeSubpath()
    return path
}

private func addSparks(to container: CALayer) {
    let shapes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(28, 24.9, 1, 3.4), (22.5, 28.9, 0.7, 2.4), (27.3, 31.7, 0.45, 1.5)]
    for (index, item) in shapes.enumerated() {
        let spark = pointerShape(sparkPath(x: 0, y: 0, small: item.2 * 0.6, large: item.3 * 0.6), width: 0.66)
        spark.position = CGPoint(x: item.0 * 0.6, y: item.1 * 0.6)
        let opacity = CAKeyframeAnimation(keyPath: "opacity")
        opacity.values = [0.55, 1, 0.55]
        let scale = CAKeyframeAnimation(keyPath: "transform.scale")
        scale.values = [0.75, 1.15, 0.75]
        let twinkle = CAAnimationGroup()
        twinkle.animations = [opacity, scale]
        twinkle.duration = 1.8
        twinkle.repeatCount = .infinity
        twinkle.beginTime = CACurrentMediaTime() + Double(index) * 0.6
        spark.add(twinkle, forKey: "twinkle")
        container.addSublayer(spark)
    }
}

private final class PointerBadge {
    let layer = CALayer()
    private let pill = CALayer()
    private let text = CATextLayer()
    private let ring = CAShapeLayer()

    init(scale: CGFloat) {
        layer.anchorPoint = .zero
        layer.bounds = CGRect(x: 0, y: 0, width: 330, height: 60)
        let arrow = CGMutablePath()
        arrow.move(to: CGPoint(x: 3, y: 2.52))
        arrow.addLine(to: CGPoint(x: 14.76, y: 11.16))
        arrow.addCurve(to: CGPoint(x: 14.46, y: 12.36), control1: CGPoint(x: 15.24, y: 11.52), control2: CGPoint(x: 15.06, y: 12.24))
        arrow.addLine(to: CGPoint(x: 9.66, y: 13.32))
        arrow.addLine(to: CGPoint(x: 6.3, y: 17.64))
        arrow.addCurve(to: CGPoint(x: 5.1, y: 17.4), control1: CGPoint(x: 5.94, y: 18.12), control2: CGPoint(x: 5.22, y: 18))
        arrow.addLine(to: CGPoint(x: 2.46, y: 3.18))
        arrow.closeSubpath()
        ring.path = CGPath(ellipseIn: CGRect(x: -6.6, y: -7.2, width: 19.2, height: 19.2), transform: nil)
        ring.fillColor = NSColor.clear.cgColor
        ring.strokeColor = pointerGreen
        ring.lineWidth = 1.5
        ring.opacity = 0
        layer.addSublayer(ring)
        layer.addSublayer(pointerShape(arrow, width: 1.92))
        addSparks(to: layer)
        pill.backgroundColor = NSColor(calibratedWhite: 0.025, alpha: 0.96).cgColor
        pill.cornerRadius = 12
        pill.addSublayer(text)
        layer.addSublayer(pill)
        text.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        text.fontSize = 11
        text.foregroundColor = NSColor.white.cgColor
        text.contentsScale = scale
        text.truncationMode = .end
    }

    func label(_ label: String) {
        let value = String(label.prefix(80))
        let width = min(290, max(48, (value as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 11, weight: .semibold)]).width + 20))
        pill.frame = CGRect(x: 21.6, y: 18, width: width, height: 25)
        text.frame = CGRect(x: 10, y: 5, width: width - 20, height: 16)
        text.string = value
    }

    func pulse() {
        let pulse = CAAnimationGroup()
        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 1
        opacity.toValue = 0
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.35
        scale.toValue = 1.7
        pulse.animations = [opacity, scale]
        pulse.duration = 0.6
        pulse.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(pulse, forKey: "press")
    }
}

/** A screen point (top-left origin, main screen at 0,0) inside one screen's own overlay, which is flipped too. */
func pointerScreenPoint(_ point: CGPoint, screen: CGRect, mainHeight: CGFloat) -> CGPoint {
    CGPoint(x: point.x - screen.minX - 3, y: point.y - (mainHeight - screen.maxY) - 2.52)
}

// One overlay per screen: with separate Spaces per display, macOS shows a window spanning several on one only.
final class PointerOverlay {
    private struct Surface {
        let window: NSWindow
        let badge: PointerBadge
        let screen: CGRect
    }
    private struct Entry {
        var surfaces: [Surface]
        var at: CGPoint
        var idle: DispatchWorkItem?
    }
    private var entries: [String: Entry] = [:]
    var windowIDs: Set<CGWindowID> {
        Set(entries.values.flatMap { $0.surfaces.map { CGWindowID($0.window.windowNumber) } })
    }

    private func surface(for screen: NSScreen) -> Surface {
        let window = PointerWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .screenSaver
        #if POINTER_RECORDING
        window.sharingType = .readOnly
        #else
        window.sharingType = .none
        #endif
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
        window.isReleasedWhenClosed = false
        window.setAccessibilityElement(false)
        window.setFrame(screen.frame, display: false)
        let view = pointerCanvas(frame: CGRect(origin: .zero, size: screen.frame.size))
        view.setAccessibilityElement(false)
        view.wantsLayer = true
        window.contentView = view
        let badge = PointerBadge(scale: screen.backingScaleFactor)
        view.layer?.addSublayer(badge.layer)
        return Surface(window: window, badge: badge, screen: screen.frame)
    }

    /** The agent's overlays, made again when screens were added, removed or moved. */
    private func surfaces(_ current: [Surface]) -> [Surface] {
        let screens = NSScreen.screens
        if current.map(\.screen) == screens.map(\.frame) { return current }
        for old in current { old.window.close() }
        return screens.map(surface(for:))
    }

    func move(agent: String, label: String, point: CGPoint, completion: @escaping () -> Void) {
        guard let main = NSScreen.screens.first?.frame else { completion(); return }
        if entries[agent] == nil {
            if entries.count >= 16, let key = entries.keys.sorted().first, let removed = entries.removeValue(forKey: key) {
                removed.idle?.cancel()
                for old in removed.surfaces { old.window.close() }
            }
            entries[agent] = Entry(surfaces: [], at: CGPoint(x: main.midX, y: main.midY))
        }
        guard var entry = entries[agent] else { completion(); return }
        entry.idle?.cancel()
        entry.surfaces = surfaces(entry.surfaces)
        let distance = hypot(point.x - entry.at.x, point.y - entry.at.y)
        let animate = distance >= 1 && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        CATransaction.begin()
        if animate { CATransaction.setCompletionBlock(completion) }
        for item in entry.surfaces {
            let from = pointerScreenPoint(entry.at, screen: item.screen, mainHeight: main.maxY)
            let to = pointerScreenPoint(point, screen: item.screen, mainHeight: main.maxY)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            item.badge.label(label)
            item.badge.layer.position = to
            CATransaction.commit()
            if animate { item.badge.layer.add(pointerTravelAnimation(from: from, to: to), forKey: "travel") }
            item.window.orderFrontRegardless()
        }
        CATransaction.commit()
        if !animate { completion() }
        entry.at = point
        let idle = DispatchWorkItem { [weak self] in self?.hide(agent: agent) }
        entry.idle = idle
        entries[agent] = entry
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: idle)
    }

    func say(agent: String, label: String, completion: @escaping () -> Void) {
        let main = NSScreen.screens.first?.frame ?? .zero
        move(agent: agent, label: label, point: entries[agent]?.at ?? CGPoint(x: main.midX, y: main.midY), completion: completion)
    }

    func pulse(agent: String) { entries[agent]?.surfaces.forEach { $0.badge.pulse() } }

    func hide(agent: String? = nil) {
        for key in agent.map({ [$0] }) ?? Array(entries.keys) {
            entries[key]?.idle?.cancel()
            entries[key]?.surfaces.forEach { $0.window.orderOut(nil) }
        }
    }
}
