import Foundation
import Darwin

private func unnamedAddress(_ fd: Int32, peer: Bool) -> Bool {
    var address = sockaddr_un()
    var length = socklen_t(MemoryLayout<sockaddr_un>.size)
    let result = withUnsafeMutablePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            peer ? getpeername(fd, $0, &length) : getsockname(fd, $0, &length)
        }
    }
    // Only the Darwin representation measured in this spike is accepted.
    guard result == 0, length == 16, address.sun_len == 16,
          address.sun_family == sa_family_t(AF_UNIX) else { return false }
    return withUnsafeBytes(of: address) { bytes in bytes[2..<16].allSatisfy { $0 == 0 } }
}

func supportedTransport(_ fd: Int32, writing: Bool) -> Bool {
    var status = stat()
    let flags = fcntl(fd, F_GETFL)
    guard fstat(fd, &status) == 0, flags >= 0 else { return false }
    let access = flags & O_ACCMODE
    guard writing ? access != O_RDONLY : access != O_WRONLY else { return false }
    if status.st_mode & S_IFMT == S_IFIFO { return true }
    guard status.st_mode & S_IFMT == S_IFSOCK else { return false }
    var type: Int32 = 0
    var length = socklen_t(MemoryLayout<Int32>.size)
    guard getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &length) == 0,
          length == MemoryLayout<Int32>.size, type == SOCK_STREAM else { return false }
    var listening: Int32 = -1
    length = socklen_t(MemoryLayout<Int32>.size)
    let result = getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &listening, &length)
    if result == 0 {
        guard length == MemoryLayout<Int32>.size, listening == 0 else { return false }
    } else if errno != ENOPROTOOPT { return false }
    return unnamedAddress(fd, peer: false) && unnamedAddress(fd, peer: true)
}

// A quiet check rejects already-queued commands/EOF; it cannot exclude a concurrent peer close.
func transportInputQuiet(_ fd: Int32) -> Bool {
    var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    while true {
        let result = poll(&descriptor, 1, 0)
        if result < 0 && errno == EINTR { continue }
        return result == 0
    }
}

func isTransportHello(_ input: Data?) -> Bool {
    guard let input, let object = try? JSONSerialization.jsonObject(with: input) as? [String: String] else {
        return false
    }
    return object == ["op": "hello"]
}
