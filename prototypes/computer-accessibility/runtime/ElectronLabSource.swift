import Foundation

protocol RendererNodeSource: WindowNodeSource {
    func documentURL(_ element: Element) throws -> String?
}

struct SyntheticRendererSource<Source: RendererNodeSource>: WindowNodeSource {
    let native: Source
    let urls: Set<String>
    var onAllowedDocument: (() throws -> Void)? = nil

    func same(_ left: Source.Element, _ right: Source.Element) -> Bool { native.same(left, right) }

    func metadata(_ element: Source.Element) throws -> NodeMetadata {
        let metadata = try native.metadata(element)
        if metadata.role != "AXWebArea" { return metadata }
        guard let url = try native.documentURL(element), urls.contains(url) else {
            throw ObserverFailure.browserDenied
        }
        try onAllowedDocument?()
        // Only a fixed synthetic document may cross this laboratory-only boundary.
        return NodeMetadata(role: "AXGroup", subrole: nil)
    }

    func title(_ element: Source.Element) throws -> String? { try native.title(element) }
    func children(_ element: Source.Element) throws -> [Source.Element] { try native.children(element) }
}
