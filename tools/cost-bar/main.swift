// OpenCodeCostBar — Layer 2: native macOS menu-bar SR pill (no dependencies).
//
// Reads the live state file maintained by plugins/cost-tracker.js
//   ~/.local/share/opencode/sr-live.json   (override: $SR_LIVE)
// and shows the closest-to-limit Go window (weekly/monthly) as a menu-bar
// pill — the 5h window is no longer the binding constraint. Event-driven
// refresh via DispatchSource (file writes) + a 5s mtime stat backup; 0% idle CPU.
//
// Build: ./build.sh   (swiftc, AppKit only)
// Verify without launching GUI: ./OpenCodeCostBar.app/Contents/MacOS/OpenCodeCostBar --self-test
import AppKit
import Foundation

let livePath: String = {
    if let o = ProcessInfo.processInfo.environment["SR_LIVE"], !o.isEmpty { return o }
    return (NSHomeDirectory() as NSString).appendingPathComponent(".local/share/opencode/sr-live.json")
}()
let dashPath = (NSHomeDirectory() as NSString).appendingPathComponent(".opencode/usage-dashboard/dashboard.html")

struct Win: Decodable {
    var label: String?; var usedUsd: Double?; var usedSR: Int?; var allowedSR: Int?
    var pct: Double?; var remainingPct: Double?; var freesAt: String?; var freesInSec: Double?
}
struct Model: Decodable {
    var model: String?; var cap: Int?
    var msgs: [String: Int]?; var usd: [String: Double]?
    var costPerMsg: Double?; var allowedMsgs: Int?; var remainingMsgs: Int?
}
struct Turn: Decodable { var model: String?; var usd: Double?; var sr: Int? }
struct State: Decodable {
    var schema: Int?; var generated_at: String?; var fullRecomputeAt: String?; var lastActivity: String?
    var paceUsdPerDay: Double?
    var windows: [String: Win]?; var perModel: [Model]?; var alerts: [String]?; var lastTurn: Turn?
}

func loadState() -> State? {
    guard let d = try? Data(contentsOf: URL(fileURLWithPath: livePath)) else { return nil }
    return try? JSONDecoder().decode(State.self, from: d)
}
// Self-healing read: if the file is missing, stale, or written by pre-v2 code,
// compute the state directly instead of showing a useless pill. This keeps the
// bar correct even when the plugin host is old or has not seen a turn yet.
func nodeBinary() -> String? {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if FileManager.default.isExecutableFile(atPath: p) { return p }
    }
    return nil
}
func computeState() -> State? {
    guard let node = nodeBinary() else { return nil }
    let script = (NSHomeDirectory() as NSString).appendingPathComponent(
        ".config/opencode/skills/model-benchmarks/scripts/sr-calc.mjs")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = [script]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { return nil }
    return try? JSONDecoder().decode(State.self, from: data)
}
func parseISO(_ x: String?) -> Date? {
    guard let x, !x.isEmpty else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: x) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: x)
}
func dur(_ s: Double?) -> String {
    guard let s, s.isFinite, s >= 0 else { return "—" }
    if s >= 86400 { return String(format: "%.1fd", s / 86400) }
    if s >= 3600 { return String(format: "%.1fh", s / 3600) }
    return "\(max(1, Int((s / 60).rounded())))m"
}
// Stale = data that cannot be trusted, not data that is merely old: an idle
// file is exact. Only activity AFTER the last full recompute leaves uncorrected
// incremental drift. A pre-v2 writer is always suspect.
func isStale(_ s: State) -> Bool {
    if s.schema != 2 { return true }
    guard let full = parseISO(s.fullRecomputeAt ?? s.generated_at) else { return true }
    let age = Date().timeIntervalSince(full)
    guard age > 600 else { return false }
    if let la = parseISO(s.lastActivity), la > full { return true }
    return false
}
func dropIn(_ w: Win) -> Double? {
    if let iso = w.freesAt, let d = parseISO(iso) { return max(0, d.timeIntervalSinceNow) }
    return w.freesInSec
}
func shortModel(_ m: String) -> String { m.split(separator: "/").last.map(String.init) ?? m }

// Pill tracks the binding window: whichever of 7d/30d is closest to its cap
// (tie goes to 7d). The 5h window stays visible in the menu, last.
func binding(_ d7: Win, _ d30: Win) -> (String, Win) {
    return (d7.pct ?? 0) >= (d30.pct ?? 0) ? ("7d", d7) : ("30d", d30)
}
func winLine(_ name: String, _ w: Win) -> String {
    var s = "\(name): \(Int((w.pct ?? 0).rounded()))% used"
    if let left = w.remainingPct { s += " · \(Int(left.rounded()))% left" }
    if let d = dropIn(w) { s += " · next drop in \(dur(d))" }
    return s
}
// Pill prefix: the binding window's name is less useful than how long until
// headroom actually returns, so show that ("4.1d"). Falls back to the name on
// a window with no spend inside it.
func remainingLabel(_ name: String, _ w: Win) -> String {
    return dropIn(w).map(dur) ?? name
}

// ---- headless verification (no GUI): prints the pill + menu body, exits ----
if CommandLine.arguments.contains("--self-test") {
    guard let s = loadState(), let h5 = s.windows?["h5"], let d7 = s.windows?["d7"], let d30 = s.windows?["d30"] else {
        print("SELF-TEST FAIL: cannot parse \(livePath)"); exit(1)
    }
    let (bwLabel, bw) = binding(d7, d30)
    print("PILL: ⚡ \(remainingLabel(bwLabel, bw)) \(Int(bw.pct ?? 0))%  (amber≥70 red≥90: \( (bw.pct ?? 0) >= 90 ? "RED" : (bw.pct ?? 0) >= 70 ? "AMBER" : "ok"), stale: \(isStale(s)))")
    for (k, w) in [("7d", d7), ("30d", d30), ("5h", h5)] {
        print("WIN \(k): \(winLine(k, w))")
    }
    if let p = s.paceUsdPerDay, p > 0 { print(String(format: "PACE: $%.2f/day", p)) }
    for m in (s.perModel ?? []).filter({ (($0.msgs?["d30"] ?? 0) > 0) && (($0.cap ?? -1) > 0) }).sorted(by: { ($0.usd?["d30"] ?? 0) > ($1.usd?["d30"] ?? 0) }) {
        print("MODEL \(shortModel(m.model ?? "?")): 30d $\(m.usd?["d30"] ?? 0) of $\(m.cap ?? -1) cap · ~\(m.remainingMsgs ?? -1) msgs left")
    }
    print("ALERTS: \((s.alerts ?? []).joined(separator: ", "))")
    if let t = s.lastTurn { print("LAST TURN: \(t.model ?? "?") $\(t.usd ?? 0)") }
    print("SELF-TEST OK"); exit(0)
}

// ---- menu-bar app ----
final class Delegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    var menu = NSMenu()
    var fd: Int32 = -1
    var src: DispatchSourceFileSystemObject?
    var lastMtime: Date?
    var lastFallback: Date?

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

    func pill(_ label: String, _ pct: Double, stale: Bool) -> NSAttributedString {
        let color: NSColor = stale ? .secondaryLabelColor
            : (pct >= 90 ? .systemRed : pct >= 70 ? .systemOrange : .labelColor)
        let text = stale ? "⚡ \(label) —" : "⚡ \(label) \(Int(pct))%"
        return NSAttributedString(string: text,
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
        var s = loadState()
        var live = s != nil && !isStale(s!)
        // Repair the display (not the file) at most once a minute when the
        // shared state cannot be trusted. 70ms blocking, off the hot path.
        if !live, lastFallback.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
            lastFallback = Date()
            if let fresh = computeState() { s = fresh; live = true }
        }
        guard let s, let h5 = s.windows?["h5"], let d7 = s.windows?["d7"], let d30 = s.windows?["d30"] else {
            item.button?.attributedTitle = NSAttributedString(string: "⚡ …")
            menu.addItem(line("no Go spend data yet — send one Go turn"))
            menu.addItem(.separator()); menu.addItem(quitItem()); return
        }
        let (bwLabel, bw) = binding(d7, d30)
        item.button?.attributedTitle = pill(remainingLabel(bwLabel, bw), bw.pct ?? 0, stale: !live)
        for (k, w) in [("7d rolling", d7), ("30d rolling", d30), ("5h rolling", h5)] {
            menu.addItem(line(winLine(k, w)))
        }
        if let pace = s.paceUsdPerDay, pace > 0, let allowed = d7.allowedSR {
            let left = max(0, Double(allowed) * 0.01 - (d7.usedUsd ?? 0))
            let days = left / pace
            menu.addItem(line(String(format: "pace $%.2f/day · weekly headroom $%.2f → %@", pace, left,
                days < 7 ? String(format: "~%.1fd at this pace", days) : "holds")))
        }
        if !live {
            menu.addItem(.separator())
            menu.addItem(line(s.schema == 2
                ? "state behind — showing a direct DB read"
                : "old cost-tracker state — restart OpenCode", mono: false))
        }
        menu.addItem(.separator())
        let gos = (s.perModel ?? []).filter { (($0.msgs?["d30"] ?? 0) > 0) && (($0.cap ?? -1) > 0) }
            .sorted { ($0.usd?["d30"] ?? 0) > ($1.usd?["d30"] ?? 0) }.prefix(6)
        for m in gos {
            menu.addItem(line("\(shortModel(m.model ?? "?")): 30d $\(String(format: "%.2f", m.usd?["d30"] ?? 0)) of $\(m.cap ?? 0) · ~\(m.remainingMsgs ?? 0) msgs left"))
        }
        if let a = s.alerts, !a.isEmpty {
            menu.addItem(.separator())
            menu.addItem(line("⚠ \(a.joined(separator: ", "))", mono: false))
        }
        if let t = s.lastTurn, (t.usd ?? 0) >= 0.05 {
            menu.addItem(line("last heavy turn: \(shortModel(t.model ?? "?")) $\(t.usd ?? 0)"))
        }
        menu.addItem(.separator())
        menu.addItem(action("Open usage dashboard", #selector(openDash)))
        menu.addItem(action("Open model selection guide", #selector(openGuide)))
        menu.addItem(.separator()); menu.addItem(quitItem())
    }
    func action(_ t: String, _ sel: Selector) -> NSMenuItem { NSMenuItem(title: t, action: sel, keyEquivalent: "") }
    func quitItem() -> NSMenuItem { let i = NSMenuItem(title: "Quit Cost Bar", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); i.target = NSApp; return i }

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
