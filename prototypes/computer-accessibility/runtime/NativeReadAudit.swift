import Foundation
import ApplicationServices

extension NativeNodeSource: RendererNodeSource {
    func documentURL(_ element: AXUIElement) throws -> String? {
        guard let value = try attribute(element, kAXURLAttribute, optional: true), let url = value as? URL else { return nil }
        return url.absoluteString
    }
}

final class NativeReadAudit {
    private struct Entry {
        let element: AXUIElement
        var attributes: Set<String> = []
        var filtered = false
    }
    private var entries: [Entry] = []
    private var counts: [String: Int] = [:]
    private var overflow = false
    private(set) var allowedDocuments = 0
    private(set) var deniedDocuments = 0
    private(set) var filteredNodes = 0

    func requested(_ element: AXUIElement, _ attribute: String) {
        let known = [kAXWindowAttribute, kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute,
                     kAXChildrenAttribute, kAXURLAttribute]
        let name = known.contains(attribute) ? attribute : "other"
        counts[name, default: 0] += 1
        guard let index = index(element) else { return }
        entries[index].attributes.insert(name)
    }

    private func index(_ element: AXUIElement) -> Int? {
        if let index = entries.firstIndex(where: { CFEqual($0.element, element) }) { return index }
        guard entries.count < 512 else { overflow = true; return nil }
        entries.append(Entry(element: element))
        return entries.count - 1
    }

    func filtered(_ element: AXUIElement) {
        guard let index = index(element) else { return }
        if !entries[index].filtered { filteredNodes += 1 }
        entries[index].filtered = true
    }

    func document(_ element: AXUIElement, allowed: Bool) {
        if allowed { allowedDocuments += 1 }
        else { deniedDocuments += 1; filtered(element) }
    }

    var summary: NativeReadSummary {
        let forbidden: Set<String> = [kAXTitleAttribute, kAXChildrenAttribute]
        return NativeReadSummary(attributeRequests: counts, allowedDocuments: allowedDocuments,
            deniedDocuments: deniedDocuments, filteredNodes: filteredNodes, overflow: overflow,
            filteredContentRequested: entries.contains { $0.filtered && !$0.attributes.isDisjoint(with: forbidden) })
    }
}

struct NativeReadSummary: Encodable {
    let attributeRequests: [String: Int]
    let allowedDocuments: Int
    let deniedDocuments: Int
    let filteredNodes: Int
    let overflow: Bool
    let filteredContentRequested: Bool
}

struct AuditedRendererSource: RendererNodeSource {
    let native: NativeNodeSource
    let audit: NativeReadAudit
    let urls: Set<String>

    func same(_ left: AXUIElement, _ right: AXUIElement) -> Bool { native.same(left, right) }
    func metadata(_ element: AXUIElement) throws -> NodeMetadata {
        let metadata = try native.metadata(element)
        if metadata.redacted || (metadata.excluded && metadata.role != "AXWebArea") { audit.filtered(element) }
        return metadata
    }
    func documentURL(_ element: AXUIElement) throws -> String? {
        let url = try native.documentURL(element)
        audit.document(element, allowed: url.map(urls.contains) ?? false)
        return url
    }
    func title(_ element: AXUIElement) throws -> String? { try native.title(element) }
    func children(_ element: AXUIElement) throws -> [AXUIElement] { try native.children(element) }
}
