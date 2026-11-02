import Foundation
import ApplicationServices

private struct AuditTestFailure: Error {}
private func require(_ condition: Bool) throws { if !condition { throw AuditTestFailure() } }

@main
struct NativeReadAuditTests {
    static func main() throws {
        let first = AXUIElementCreateApplication(42)
        let same = AXUIElementCreateApplication(42)
        let second = AXUIElementCreateApplication(43)
        let audit = NativeReadAudit()
        audit.requested(first, kAXRoleAttribute)
        audit.requested(first, kAXSubroleAttribute)
        audit.filtered(same)
        audit.filtered(first)
        try require(audit.summary.filteredNodes == 1 && !audit.summary.filteredContentRequested)
        audit.requested(second, kAXTitleAttribute)
        try require(!audit.summary.filteredContentRequested)
        audit.requested(same, kAXTitleAttribute)
        try require(audit.summary.filteredContentRequested)
        print("PASS retained identity, deduplicated filtering and later forbidden request")

        let earlier = NativeReadAudit()
        earlier.requested(first, kAXChildrenAttribute)
        earlier.filtered(same)
        try require(earlier.summary.filteredContentRequested)
        print("PASS requests made before classification remain visible")

        let documents = NativeReadAudit()
        documents.document(first, allowed: true)
        documents.document(second, allowed: false)
        documents.requested(second, kAXWindowAttribute)
        try require(documents.summary.allowedDocuments == 1 && documents.summary.deniedDocuments == 1)
        try require(documents.summary.filteredNodes == 1 && !documents.summary.filteredContentRequested)
        print("PASS document decisions and permitted scope metadata")

        let unknown = NativeReadAudit()
        unknown.requested(first, "SYNTHETIC_UNEXPECTED_ATTRIBUTE")
        let encoded = try JSONEncoder().encode(unknown.summary)
        try require(unknown.summary.attributeRequests["other"] == 1)
        try require(!String(decoding: encoded, as: UTF8.self).contains("SYNTHETIC_"))
        print("PASS unknown attribute names are not exposed")

        let capped = NativeReadAudit()
        for pid in 1...513 { capped.requested(AXUIElementCreateApplication(Int32(pid)), kAXRoleAttribute) }
        try require(capped.summary.overflow && capped.summary.attributeRequests[kAXRoleAttribute] == 513)
        print("PASS bounded identity registry signals incomplete coverage")
        print("5 audit tests passed; no native attribute requests or real app observations")
    }
}
