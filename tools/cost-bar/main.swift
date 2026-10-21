// OpenCodeCostBar — Layer 2: native macOS menu-bar SR pill (no dependencies).
//
// Reads the live state file maintained by plugins/cost-tracker.js
//   ~/.local/share/opencode/sr-live.json   (override: $SR_LIVE)
// and shows the Go 5h rolling window as a menu-bar pill. Event-driven refresh
// via DispatchSource (file writes) + a 5s mtime stat backup; 0% idle CPU.
//
// Build: ./build.sh   (swiftc, AppKit only)
// Verify without launching GUI: ./OpenCodeCostBar.app/Contents/MacOS/OpenCodeCostBar --self-test
import AppKit
import Foundation

let livePath: String = {
    if let o = ProcessInfo.processInfo.environment["SR_LIVE"], !o.isEmpty { return o }
    return (NSHomeDirectory() as NSString).appendingPathComponent(".local/share/opencode/sr-live.json")
}()
let quotaPath = (NSHomeDirectory() as NSString).appendingPathComponent(".opencode/usage-dashboard/quota.json")
let dashPath = (NSHomeDirectory() as NSString).appendingPathComponent(".opencode/usage-dashboard/dashboard.html")

struct Win: Decodable { var label: String?; var usedUsd: Double?; var usedSR: Int?; var allowedSR: Int?; var pct: Double? }
struct Model: Decodable {
    var model: String?; var cap: Int?
    var msgs: [String: Int]?; var usd: [String: Double]?
    var costPerMsg: Double?; var allowedMsgs: Int?
}
struct Turn: Decodable { var model: String?; var usd: Double?; var sr: Int? }
struct State: Decodable {
    var generated_at: String?; var windows: [String: Win]?;
    var perModel: [Model]?; var alerts: [String]?; var lastTurn: Turn?
}

func loadState() -> State? {
    guard let d = try? Data(contentsOf: URL(fileURLWithPath: livePath)) else { return nil }
    return try? JSONDecoder().decode(State.self, from: d)
}
func loadQuota() -> [String: Any]? {
    guard let d = try? Data(contentsOf: URL(fileURLWithPath: quotaPath)),
          let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
    return j
}
func shortModel(_ m: String) -> String { m.split(separator: "/").last.map(String.init) ?? m }

// ---- headless verification (no GUI): prints the pill + menu body, exits ----
if CommandLine.arguments.contains("--self-test") {
    guard let s = loadState(), let h5 = s.windows?["h5"], let d7 = s.windows?["d7"], let d30 = s.windows?["d30"] else {
        print("SELF-TEST FAIL: cannot parse \(livePath)"); exit(1)
    }
    print("PILL: ⚡ \(h5.usedSR ?? 0) SR · \(Int(h5.pct ?? 0))%  (amber≥70 red≥90: \( (h5.pct ?? 0) >= 90 ? "RED" : (h5.pct ?? 0) >= 70 ? "AMBER" : "ok"))")
    for (k, w) in [("5h", h5), ("7d", d7), ("30d", d30)] {
        print("WIN \(k): \(w.usedSR ?? 0)/\(w.allowedSR ?? 0) SR $\(w.usedUsd ?? 0) \(Int(w.pct ?? 0))%")
    }
    for m in (s.perModel ?? []).filter({ (($0.msgs?["d7"] ?? 0) > 0) && (($0.cap ?? -1) > 0) }).sorted(by: { ($0.usd?["d7"] ?? 0) > ($1.usd?["d7"] ?? 0) }) {
        print("MODEL \(shortModel(m.model ?? "?")): 7d \(m.msgs?["d7"] ?? 0) msgs $\(m.usd?["d7"] ?? 0) $\(m.costPerMsg ?? 0)/msg runway~\(m.allowedMsgs ?? -1) cap$\(m.cap ?? -1)")
    }
    print("ALERTS: \((s.alerts ?? []).joined(separator: ", "))")
    if let t = s.lastTurn { print("LAST TURN: \(t.model ?? "?") $\(t.usd ?? 0) (\(t.sr ?? 0) SR)") }
    print("SELF-TEST OK"); exit(0)
}

// ---- menu-bar app ----
final class Delegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    var menu = NSMenu()
    var fd: Int32 = -1
    var src: DispatchSourceFileSystemObject?
    var lastMtime: Date?

    func applicationDidFinishLaunching(_ n: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        menu.delegate = self
        item.menu = menu
        refresh()
        // event-driven reload on file write (sr-calc/plugin rewrite in place)
        fd = open(livePath, O_EVTONLY)
        if fd >= 0 {
            src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: .main)
            src?.setEventHandler { [weak self] in self?.refresh() }
            src?.setCancelHandler { [weak self] in if let f = self?.fd, f >= 0 { close(f) } }
            src?.resume()
        }
        // mtime backup: catches inode replacement + quota.json changes
        _ = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let mt = (try? FileManager.default.attributesOfItem(atPath: livePath)[.modificationDate] as? Date) ?? nil
            if mt != self.lastMtime { self.refresh() }
        }
    }
    func menuWillOpen(_ m: NSMenu) { refresh() }

    func pill(_ pct: Double, _ sr: Int) -> NSAttributedString {
        let color: NSColor = pct >= 90 ? .systemRed : pct >= 70 ? .systemOrange : .labelColor
        return NSAttributedString(string: "⚡ \(sr) · \(Int(pct))%",
            attributes: [.foregroundColor: color, .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)])
    }
    func line(_ s: String, mono: Bool = true) -> NSMenuItem {
        let it = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
        it.attributedTitle = NSAttributedString(string: s, attributes: [
            .font: mono ? NSFont.monospacedSystemFont(ofSize: 11, weight: .regular) : NSFont.systemFont(ofSize: 12),
            .paragraphStyle: p])
        it.isEnabled = false
        return it
    }

    func refresh() {
        lastMtime = (try? FileManager.default.attributesOfItem(atPath: livePath)[.modificationDate] as? Date) ?? nil
        menu.removeAllItems()
        guard let s = loadState(), let h5 = s.windows?["h5"], let d7 = s.windows?["d7"], let d30 = s.windows?["d30"] else {
            item.button?.attributedTitle = NSAttributedString(string: "⚡ …")
            menu.addItem(line("no sr-live.json yet — send one Go turn"))
            menu.addItem(.separator()); menu.addItem(quitItem()); return
        }
        item.button?.attributedTitle = pill(h5.pct ?? 0, h5.usedSR ?? 0)
        for (k, cap, w) in [("5h rolling", "$12", h5), ("7d rolling", "$30", d7), ("30d rolling", "$60", d30)] {
            menu.addItem(line("\(k): \(w.usedSR ?? 0)/\(w.allowedSR ?? 0) SR  $\(w.usedUsd ?? 0)/\(cap)  \(Int(w.pct ?? 0))%"))
        }
        if let q = loadQuota() {
            let rp = (q["rolling"] as? [String: Any])?["percent"], wp = (q["weekly"] as? [String: Any])?["percent"], mp = (q["monthly"] as? [String: Any])?["percent"]
            menu.addItem(line("official Go API: 5h \(rp ?? "–")% · wk \(wp ?? "–")% · mo \(mp ?? "–")%"))
        }
        menu.addItem(.separator())
        let gos = (s.perModel ?? []).filter { (($0.msgs?["d7"] ?? 0) > 0) && (($0.cap ?? -1) > 0) }
            .sorted { ($0.usd?["d7"] ?? 0) > ($1.usd?["d7"] ?? 0) }.prefix(6)
        for m in gos {
            menu.addItem(line("\(shortModel(m.model ?? "?")): 7d \(m.msgs?["d7"] ?? 0)msgs $\(String(format: "%.2f", m.usd?["d7"] ?? 0)) $\(m.costPerMsg ?? 0)/msg → ~\(m.allowedMsgs ?? -1) left"))
        }
        if let a = s.alerts, !a.isEmpty {
            menu.addItem(.separator())
            menu.addItem(line("⚠ \(a.joined(separator: ", "))", mono: false))
        }
        if let t = s.lastTurn, (t.sr ?? 0) >= 10 {
            menu.addItem(line("last heavy turn: \(shortModel(t.model ?? "?")) $\(t.usd ?? 0) (\(t.sr ?? 0) SR)"))
        }
        menu.addItem(.separator())
        menu.addItem(action("Refresh official Go quota", #selector(refreshQuota)))
        menu.addItem(action("Open usage dashboard", #selector(openDash)))
        menu.addItem(action("Open model selection guide", #selector(openGuide)))
        menu.addItem(.separator()); menu.addItem(quitItem())
    }
    func action(_ t: String, _ sel: Selector) -> NSMenuItem { NSMenuItem(title: t, action: sel, keyEquivalent: "") }
    func quitItem() -> NSMenuItem { let i = NSMenuItem(title: "Quit Cost Bar", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); i.target = NSApp; return i }

    @objc func refreshQuota() {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", (NSHomeDirectory() as NSString).appendingPathComponent(".config/opencode/skills/usage-dashboard/scripts/go_quota.mjs")]
        try? p.run(); p.waitUntilExit()
        refresh()
        if p.terminationStatus != 0 {
            let a = NSAlert(); a.messageText = "Go quota refresh needs an API key"
            a.informativeText = "Create one at opencode.ai dashboard → API keys, then save to ~/.local/share/opencode/.go-api-key (chmod 600) or $OPENCODE_API_KEY. Local SR burn above is unaffected."
            a.runModal()
        }
    }
    @objc func openDash() { NSWorkspace.shared.open(URL(fileURLWithPath: dashPath)) }
    @objc func openGuide() {
        NSWorkspace.shared.open(URL(fileURLWithPath: (NSHomeDirectory() as NSString)
            .appendingPathComponent(".config/opencode/skills/model-benchmarks/model-selection-guide.html")))
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.run()
