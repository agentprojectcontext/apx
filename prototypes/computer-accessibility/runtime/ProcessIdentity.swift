import Foundation
import Darwin

@main
struct ProcessIdentityProbe {
    static func main() throws {
        guard CommandLine.arguments.count == 2,
              let pid = Int32(CommandLine.arguments[1]), pid > 0 else { throw ProbeFailure.invalidTarget }
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_pid == UInt32(pid), info.pbi_start_tvsec > 0 else { throw ProbeFailure.invalidTarget }
        let data = try JSONSerialization.data(withJSONObject: ["pid": pid,
            "launchIdentity": ["seconds": info.pbi_start_tvsec, "microseconds": info.pbi_start_tvusec]],
            options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}

private enum ProbeFailure: Error { case invalidTarget }
