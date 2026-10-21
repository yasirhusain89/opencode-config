// opencode-helper-launcher: keeps bundle identity (name + icon) while a
// scheduled script runs as a child process. Reads OPCommand (array) from its
// own Info.plist, spawns it, forwards stdio + exit code.
//
// Spawn-and-wait (not exec) is deliberate: exec would replace our process
// image with bash/python and macOS Login Items would show the interpreter
// name ("bash") again — the exact problem this wrapper fixes.
import Foundation

guard let cmd = Bundle.main.infoDictionary?["OPCommand"] as? [String], !cmd.isEmpty else {
    fputs("launcher: OPCommand missing in Info.plist\n", stderr)
    exit(3)
}
let p = Process()
p.executableURL = URL(fileURLWithPath: cmd[0])
p.arguments = Array(cmd.dropFirst())
p.standardOutput = FileHandle.standardOutput
p.standardError = FileHandle.standardError
do {
    try p.run()
    p.waitUntilExit()
    exit(p.terminationStatus)
} catch {
    fputs("launcher: \(error)\n", stderr)
    exit(127)
}
