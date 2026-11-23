import Foundation
import AppKit
import CoreGraphics

struct Pose: Codable {
    let idx: Int
    let file: String
    let scale: Double
    let tx: Double
    let ty: Double
    let matches: Int
    let rms: Double
    let worldCenterX: Double
    let worldCenterY: Double
}

let posesData = try! Data(contentsOf: URL(fileURLWithPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json"))
let allPoses = try! JSONDecoder().decode([Pose].self, from: posesData)
let frameDir = "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps"

// Keep all well-locked frames spaced by >= 4 ly or 2% scale
var selectedPoses: [Pose] = []
for p in allPoses where p.rms < 1.0 && p.matches >= 10 {
    if let last = selectedPoses.last {
        let distLy = hypot(p.worldCenterX - last.worldCenterX, p.worldCenterY - last.worldCenterY)
        let scaleDiff = abs(p.scale - last.scale) / last.scale
        if distLy < 4.0 && scaleDiff < 0.02 { continue }
    }
    selectedPoses.append(p)
}
print("Selected \(selectedPoses.count) distinct frames out of \(allPoses.count)")

struct LoadedFrame {
    let pose: Pose
    let w: Int
    let h: Int
    let raw: [UInt8]
}

var loaded: [LoadedFrame] = []
let cs = CGColorSpaceCreateDeviceRGB()
for p in selectedPoses {
    let path = "\(frameDir)/\(p.file)"
    guard let nsImg = NSImage(contentsOfFile: path),
          let cg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let w = cg.width
    let h = cg.height
    var raw = [UInt8](repeating: 0, count: w * h * 4)
    if let ctx = CGContext(data: &raw, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        loaded.append(LoadedFrame(pose: p, w: w, h: h, raw: raw))
    }
}

@inline(__always) func isCleanPixel(_ px: Double, _ py: Double, _ w: Int, _ h: Int) -> Bool {
    // Full rectangular usable area excluding top nav bar, edge waypoint tracks, and right-side HUD boxes
    if py < 104.0 || py > Double(h) - 56.0 { return false }
    if px < 40.0 || px > Double(w) - 40.0 { return false }
    if px > 2200.0 && py < 125.0 { return false }
    if px > 2200.0 && py > 815.0 { return false }
    // Mask yellow quest diamond at top when it dips slightly below y=104 (always yellow R>200, G>170, B<40 near y<118)
    return true
}

func renderMosaic(
    frames: [LoadedFrame],
    wxMin: Double, wxMax: Double,
    wyMin: Double, wyMax: Double,
    outScale: Double,
    preferDetail: Bool,
    outPath: String
) {
    let outW = Int(((wxMax - wxMin) * outScale).rounded())
    let outH = Int(((wyMax - wyMin) * outScale).rounded())
    print("Rendering \(outPath) (\(outW)x\(outH) px, scale=\(outScale) px/ly)...")
    var outRaw = [UInt8](repeating: 0, count: outW * outH * 4)
    for i in stride(from: 0, to: outW * outH * 4, by: 4) {
        outRaw[i] = 5; outRaw[i+1] = 7; outRaw[i+2] = 13; outRaw[i+3] = 255
    }

    DispatchQueue.concurrentPerform(iterations: outH) { oy in
        let wy = wyMax - (Double(oy) + 0.5) / outScale
        let rowBase = oy * outW * 4
        for ox in 0..<outW {
            let wx = wxMin + (Double(ox) + 0.5) / outScale

            var bestScore = -1.0
            var bestFi = -1
            var bestPx = 0.0, bestPy = 0.0
            var bestTier = 0

            // Pass 1: find primary frame (highest tier + closest to frame center)
            for (fi, f) in frames.enumerated() {
                let s = f.pose.scale
                let px = s * wx + f.pose.tx
                let py = -s * wy + f.pose.ty
                if !isCleanPixel(px, py, f.w, f.h) { continue }

                // Check for yellow top-edge waypoint diamond dipping into y in 104..118
                if py < 122.0 {
                    let ix = min(max(Int(px.rounded()), 0), f.w - 1)
                    let iy = min(max(Int(py.rounded()), 0), f.h - 1)
                    let pi = (iy * f.w + ix) * 4
                    if Int(f.raw[pi]) > 180 && Int(f.raw[pi+1]) > 150 && Int(f.raw[pi+2]) < 50 {
                        continue
                    }
                }

                let tier = (preferDetail && s >= 13.5) ? 2 : (s >= 5.0 ? 1 : 0)
                if tier < bestTier { continue }

                // Distance to usable center (1273, 475), normalized by half-dimensions (1233, 385)
                let ndx = abs(px - 1273.0) / 1233.0
                let ndy = abs(py - 475.0) / 385.0
                let edgeDist = max(0.02, (1.0 - ndx) * (1.0 - ndy))
                // Prefer ~14.64 uniform scale among detail frames so scale is consistent
                let scaleBonus = (tier == 2 && abs(s - 14.64) < 0.5) ? 1.5 : 1.0
                let sc = edgeDist * scaleBonus

                if tier > bestTier || sc > bestScore {
                    bestTier = tier
                    bestScore = sc
                    bestFi = fi
                    bestPx = px
                    bestPy = py
                }
            }

            if bestFi >= 0 {
                let f1 = frames[bestFi]
                let ix1 = min(max(Int(bestPx.rounded()), 0), f1.w - 1)
                let iy1 = min(max(Int(bestPy.rounded()), 0), f1.h - 1)
                let p1 = (iy1 * f1.w + ix1) * 4
                let r1 = Int(f1.raw[p1])
                let g1 = Int(f1.raw[p1 + 1])
                let b1 = Int(f1.raw[p1 + 2])

                // Check if pixel is a sharp foreground feature (star dot, label, icon, dashed ring, bright zone line)
                // If background wash/nebula, blend smoothly across overlapping same-scale frames to remove vignette bands!
                let maxC = max(r1, max(g1, b1))
                let minC = min(r1, min(g1, b1))
                let isSharpFeature = (maxC > 205 && minC > 130) || (r1 < 18 && g1 < 22 && b1 > 95)

                var outR = Double(r1)
                var outG = Double(g1)
                var outB = Double(b1)

                if !isSharpFeature {
                    var sumW = bestScore * bestScore
                    var sumR = outR * sumW
                    var sumG = outG * sumW
                    var sumB = outB * sumW
                    let s1 = f1.pose.scale

                    for (fi, f) in frames.enumerated() where fi != bestFi {
                        let s = f.pose.scale
                        if abs(s - s1) > 0.8 { continue }
                        let px = s * wx + f.pose.tx
                        let py = -s * wy + f.pose.ty
                        if !isCleanPixel(px, py, f.w, f.h) { continue }
                        let ndx = abs(px - 1273.0) / 1233.0
                        let ndy = abs(py - 475.0) / 385.0
                        let w = max(0.0, (1.0 - ndx) * (1.0 - ndy))
                        let w2 = w * w
                        if w2 > sumW * 0.15 {
                            let ix = min(max(Int(px.rounded()), 0), f.w - 1)
                            let iy = min(max(Int(py.rounded()), 0), f.h - 1)
                            let pi = (iy * f.w + ix) * 4
                            sumR += Double(f.raw[pi]) * w2
                            sumG += Double(f.raw[pi+1]) * w2
                            sumB += Double(f.raw[pi+2]) * w2
                            sumW += w2
                        }
                    }
                    outR = sumR / sumW
                    outG = sumG / sumW
                    outB = sumB / sumW
                }

                let dst = rowBase + ox * 4
                outRaw[dst] = UInt8(min(max(Int(outR.rounded()), 0), 255))
                outRaw[dst + 1] = UInt8(min(max(Int(outG.rounded()), 0), 255))
                outRaw[dst + 2] = UInt8(min(max(Int(outB.rounded()), 0), 255))
                outRaw[dst + 3] = 255
            }
        }
    }

    if let ctx = CGContext(data: &outRaw, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: outW * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
       let cgOut = ctx.makeImage() {
        let rep = NSBitmapImageRep(cgImage: cgOut)
        if let png = rep.representation(using: .png, properties: [:]) {
            try! png.write(to: URL(fileURLWithPath: outPath))
            print("Saved \(outPath)")
        }
    }
}

let detailOnly = loaded.filter { $0.pose.scale >= 13.5 }
let regionalOnly = loaded.filter { $0.pose.scale >= 4.0 && $0.pose.scale < 8.5 }

// 1. Full Inner Sphere Detail-Level Stitched Map (detail frames + regional backdrop)
renderMosaic(
    frames: loaded,
    wxMin: -420.0, wxMax: 390.0,
    wyMin: -305.0, wyMax: 440.0,
    outScale: 7.0,
    preferDetail: true,
    outPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_full_detail_hybrid.png"
)

// 2. Pure Detail-Level Only Full Panorama (scale >= 13.5)
renderMosaic(
    frames: detailOnly,
    wxMin: -410.0, wxMax: 385.0,
    wyMin: -295.0, wyMax: 435.0,
    outScale: 7.0,
    preferDetail: true,
    outPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_pure_detail_full.png"
)

// 3. Native 14.64 px/ly Zoomed Detail Map: Southern Theater (Liao / Davion / Marik)
renderMosaic(
    frames: detailOnly,
    wxMin: -135.0, wxMax: 215.0,
    wyMin: -285.0, wyMax: -20.0,
    outScale: 14.64,
    preferDetail: true,
    outPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_zoomed_south_14px.png"
)

// 4. Zoomed Detail Map: Northern/Eastern Theater (Steiner / Rasalhague / Kurita)
renderMosaic(
    frames: detailOnly,
    wxMin: -350.0, wxMax: 350.0,
    wyMin: -60.0, wyMax: 430.0,
    outScale: 10.0,
    preferDetail: true,
    outPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_zoomed_north_10px.png"
)

// 5. Regional Overview Stitched Map (regional frames 4.0..8.5 px/ly)
renderMosaic(
    frames: regionalOnly,
    wxMin: -280.0, wxMax: 320.0,
    wyMin: -310.0, wyMax: 150.0,
    outScale: 5.69,
    preferDetail: false,
    outPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_regional_crests.png"
)
