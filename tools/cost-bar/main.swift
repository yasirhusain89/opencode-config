// OpenCodeCostBar — Layer 2: native macOS menu-bar SR pill (no dependencies).
//
// OWNS its data: recomputes the state itself every 60s via sr-calc.mjs and
// rewrites ~/.local/share/opencode/sr-live.json (override: $SR_LIVE)
// atomically, then shows the closest-to-limit Go window (weekly/monthly) as
// a menu-bar pill. plugins/cost-tracker.js stays as the in-turn fast path
// (toasts, ≤60s patches) but the bar no longer depends on any opencode
// process being alive, current, or recently active — rolling windows decay
// with wall-clock even when idle, so only a writer on a timer keeps them
// honest. Event-driven refresh via DispatchSource (file writes) + a 5s
// mtime stat backup.
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
    var label: String?; var usedUsd: Double?; var usedReq: Int?
    var pct: Double?; var remainingPct: Double?; var freesAt: String?; var freesInSec: Double?
    var capReq: Int?; var allowedReq: Int?; var calibrated: Bool?
}
struct Model: Decodable {
    var model: String?; var provider: String?
    var msgs: [String: Int]?; var usd: [String: Double]?
    var costPerMsg: Double?; var shareMonth: Double?; var shareGo: Double?
}
struct Turn: Decodable { var model: String?; var usd: Double?; var sr: Int? }
struct State: Decodable {
    var schema: Int?; var generated_at: String?; var fullRecomputeAt: String?; var lastActivity: String?
    var paceUsdPerDay: Double?; var paceReqPerDay: Double?
    var windows: [String: Win]?; var perModel: [Model]?; var alerts: [String]?; var lastTurn: Turn?
}

func loadState() -> State? {
    guard let d = try? Data(contentsOf: URL(fileURLWithPath: livePath)) else { return nil }
    return try? JSONDecoder().decode(State.self, from: d)
}
// Self-healing read: if the file is missing, stale, or written by pre-v3 code,
// compute the state directly instead of showing a useless pill. This keeps the
// bar correct even when the plugin host is old or has not seen a turn yet.
func nodeBinary() -> String? {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if FileManager.default.isExecutableFile(atPath: p) { return p }
    }
    return nil
}
func computeRaw() -> Data? {
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
    guard p.terminationStatus == 0, !data.isEmpty else { return nil }
    return data
}
func computeState() -> State? {
    guard let data = computeRaw() else { return nil }
    return try? JSONDecoder().decode(State.self, from: data)
}
// Atomic rewrite of the shared file (rename, same volume): the plugin also
// writes it on turn events — a torn JSON read decodes to nil and blanks
// the pill until the next tick.
func writeLiveAtomically(_ data: Data) {
    let tmpURL = URL(fileURLWithPath: livePath + ".tmp.\(ProcessInfo.processInfo.processIdentifier)")
    let dstURL = URL(fileURLWithPath: livePath)
    do {
        try data.write(to: tmpURL, options: .atomic)
        _ = try FileManager.default.replaceItemAt(dstURL, withItemAt: tmpURL)
    } catch {
        try? FileManager.default.removeItem(at: tmpURL)
    }
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
// Stale = data that cannot be trusted. Two ways to get there: activity AFTER
// the last full recompute (incremental drift the next recompute hasn't
// corrected — usually a recompute failure, worth flagging), or a recompute
// so old the windows have slid without it: an idle file is NOT
// exact, the trailing 5h window decays with wall-clock even with zero turns.
// A pre-v4 writer is always suspect.
func isStale(_ s: State) -> Bool {
    if s.schema != 4 { return true }
    guard let full = parseISO(s.fullRecomputeAt ?? s.generated_at) else { return true }
    let age = Date().timeIntervalSince(full)
    if age > 1800 { return true }
    guard age > 600 else { return false }
    if let la = parseISO(s.lastActivity), la > full { return true }
    return false
}
func dropIn(_ w: Win) -> Double? {
    if let iso = w.freesAt, let d = parseISO(iso) { return max(0, d.timeIntervalSinceNow) }
    return w.freesInSec
}
func shortModel(_ m: String) -> String { m.split(separator: "/").last.map(String.init) ?? m }

// Pill tracks the binding window: whichever of week/month is closest to its
// cap. Caps are account-wide (console 2026-10-26) — no model is named.
// Uncalibrated windows are demoted below calibrated ones: their pct is a raw
// DB count over a cap and can diverge from the console by 7x+ (midnight flood),
// so they must not steal the pill when a calibrated window is available.
func binding(_ week: Win, _ month: Win) -> (String, Win) {
    let wkCal = week.calibrated != false
    let moCal = month.calibrated != false
    if wkCal != moCal { return wkCal ? ("week", week) : ("month", month) }
    return (week.pct ?? 0) >= (month.pct ?? 0) ? ("week", week) : ("month", month)
}
func winLine(_ w: Win) -> String {
    let name = w.label ?? "?"
    var s: String
    if let pct = w.pct {
        s = "\(name): \(Int(pct.rounded()))% used"
        if let left = w.remainingPct { s += " · \(max(0, Int(left.rounded())))% left" }
    } else {
        s = "\(name): \((w.usedReq ?? 0).formatted()) reqs"
    }
    // Fixed periods reset on a schedule; the rolling window expires oldest-first.
    let dropPhrase = (w.label ?? "").hasPrefix("Monthly") ? "resets in" : "next drop in"
    if let d = dropIn(w) { s += " · \(dropPhrase) \(dur(d))" } else { s += " · no cap yet" }
    if w.calibrated == false && w.pct != nil { s += " · UNCALIBRATED" }
    return s
}
// Menu-bar-friendly model names (the full ids are too wide for the pill).
func nick(_ model: String) -> String {
    let id = shortModel(model)
    let map = ["muse-spark-1.3-contributor": "muse", "gemini-4-argon": "argon",
               "gemini-4-argon-contributor": "argon", "deepseek-v4.1-flash": "dseek-fl",
               "deepseek-v4-pro": "dseek-pro", "glm-5.3-flash": "glm-fl", "glm-5.3": "glm",
               "kimi-k3.1-pro": "kimi", "kimi-k3": "kimi", "mimo-v2.6-pro": "mimo",
               "mimo-v2.6-flash": "mimo-fl", "space-bunny": "bunny", "step-5-preview": "step5",
               "claude-haiku-5.5": "haiku", "claude-haiku-5-5": "haiku"]
    return map[id] ?? id
}
// Pill prefix: the binding window's name is less useful than how long until
// headroom actually returns, so show that ("4.1d"). Falls back to the name on
// a window with no spend inside it.
func remainingLabel(_ name: String, _ w: Win) -> String {
    return dropIn(w).map(dur) ?? name
}

// ---- headless verification (no GUI): prints the pill + menu body, exits ----
if CommandLine.arguments.contains("--self-test") {
    guard let s = loadState(), let rolling = s.windows?["rolling"], let week = s.windows?["week"], let month = s.windows?["month"] else {
        print("SELF-TEST FAIL: cannot parse \(livePath)"); exit(1)
    }
    let (bwLabel, bw) = binding(week, month)
    print("PILL: ⚡ \(remainingLabel(bwLabel, bw)) \(Int(bw.pct ?? 0))%  (amber≥70 red≥90: \( (bw.pct ?? 0) >= 90 ? "RED" : (bw.pct ?? 0) >= 70 ? "AMBER" : "ok"), stale: \(isStale(s)), binding: \(bwLabel)")
    for w in [month, week, rolling] {
        print("WIN: \(winLine(w))")
    }
    if let p = s.paceReqPerDay, p > 0 { print(String(format: "PACE: %.0f req/day", p)) }
    for m in (s.perModel ?? []).filter({ ($0.provider == "opencode-go") && (($0.msgs?["month"] ?? 0) > 0) }).sorted(by: { ($0.msgs?["month"] ?? 0) > ($1.msgs?["month"] ?? 0) }).prefix(6) {
        print("MODEL \(nick(m.model ?? "?")): month \(m.msgs?["month"] ?? 0) reqs (\(Int((m.shareGo ?? 0).rounded()))% of Go) · week \(m.msgs?["week"] ?? 0)")
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
    var lastRecompute: Date?

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
        // The bar owns its data: full recompute on a timer (background — a
        // node spawn must never block the menu), so the pill stays exact
        // with opencode closed, idle, or running stale plugin code.
        _ = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: true) { [weak self] _ in
            self?.recomputeIfDue()
        }
        recomputeIfDue()
    }
    func recomputeIfDue() {
        let now = Date()
        if let last = lastRecompute, now.timeIntervalSince(last) < 60 { return }
        lastRecompute = now
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self, let data = computeRaw(),
                  (try? JSONDecoder().decode(State.self, from: data)) != nil else { return }
            writeLiveAtomically(data)
            DispatchQueue.main.async { self.refresh() }
        }
    }
    func menuWillOpen(_ m: NSMenu) { refresh() }

    func pill(_ label: String, _ pct: Double, stale: Bool) -> NSAttributedString {
        let color: NSColor = stale ? .secondaryLabelColor
            : (pct >= 90 ? .systemRed : pct >= 70 ? .systemOrange : .labelColor)
        // Schema 4: the pill is account-level — week or month, never a model
        // name. Blocked shows only the time to unblock.
        var text = "⚡ \(label) \(Int(pct))%"
        if pct >= 100 { text = "⛔ BLOCKED · \(label)" }
        return NSAttributedString(string: text,
            attributes: [.foregroundColor: color, .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)])
    }
    // Info rows must stay ENABLED (no-op action) or AppKit dims them to
    // secondary-label grey and the numbers become unreadable in the open menu.
    @objc func noop() {}
    func line(_ s: String, mono: Bool = true) -> NSMenuItem {
        let it = NSMenuItem(title: "", action: #selector(noop), keyEquivalent: "")
        it.target = self
        let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
        it.attributedTitle = NSAttributedString(string: s, attributes: [
            .font: mono ? NSFont.monospacedSystemFont(ofSize: 11, weight: .regular) : NSFont.systemFont(ofSize: 12),
            .paragraphStyle: p,
            .foregroundColor: NSColor.labelColor])
        return it
    }

    func refresh() {
        lastMtime = (try? FileManager.default.attributesOfItem(atPath: livePath)[.modificationDate] as? Date) ?? nil
        menu.removeAllItems()
        var s = loadState()
        var live = s != nil && !isStale(s!)
        // Repair the display (not the file) when the shared state cannot be
        // trusted. A WRONG-SCHEMA file (pre-v4 writer, e.g. the cached old
        // plugin before the opencode restart) rewrites the file every turn, so
        // the throttled fallback would open the menu on it almost always —
        // recover immediately instead. The 60s throttle only bounds repeated
        // same-schema staleness. 70ms blocking, off the hot path.
        if !live {
            if s?.schema != 4 || lastFallback.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                lastFallback = Date()
                if let fresh = computeState() { s = fresh; live = true }
            }
        }
        guard let s, let rolling = s.windows?["rolling"], let week = s.windows?["week"], let month = s.windows?["month"] else {
            item.button?.attributedTitle = NSAttributedString(string: "⚡ …")
            menu.addItem(line("no usage data yet — send one turn"))
            menu.addItem(.separator()); menu.addItem(quitItem()); return
        }
        let (bwLabel, bw) = binding(week, month)
        let drop = remainingLabel(bwLabel, bw)
        item.button?.attributedTitle = pill(drop, bw.pct ?? 0, stale: !live)
        for w in [month, week, rolling] {
            menu.addItem(line(winLine(w)))
        }
        if let pace = s.paceReqPerDay, pace > 0 {
            if let allowed = month.allowedReq, allowed > 0 {
                let days = Double(allowed) / pace
                menu.addItem(line(String(format: "pace %.0f req/day · monthly headroom %d reqs → %@", pace, allowed,
                    days < 30 ? String(format: "~%.1fd at this pace", days) : "holds")))
            } else if let d = dropIn(month) {
                menu.addItem(line(String(format: "pace %.0f req/day · cap reached — resets %@", pace, dur(d))))
            }
        }
        if !live {
            menu.addItem(.separator())
            menu.addItem(line(s.schema == 4
                ? "state behind — showing a direct DB read"
                : "old cost-tracker state — restart OpenCode", mono: false))
        }
        menu.addItem(.separator())
        let gos = (s.perModel ?? []).filter { $0.provider == "opencode-go" && (($0.msgs?["month"] ?? 0) > 0) }
            .sorted { ($0.msgs?["month"] ?? 0) > ($1.msgs?["month"] ?? 0) }.prefix(6)
        for m in gos {
            menu.addItem(line("\(nick(m.model ?? "?")): month \(m.msgs?["month"] ?? 0) (\(Int((m.shareGo ?? 0).rounded()))%) · week \(m.msgs?["week"] ?? 0)"))
        }
        let otherMonth = (s.perModel ?? []).filter { $0.provider != "opencode-go" }.reduce(0) { $0 + ($1.msgs?["month"] ?? 0) }
        if otherMonth > 0 {
            menu.addItem(line("non-Go this month: \(otherMonth) reqs (counted in caps)"))
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
