import Foundation
import AppKit
import CoreGraphics

struct StarSystem: Codable {
    let id: Int
    let name: String
    let x: Double
    let y: Double
}
struct StarMapFile: Codable {
    let systems: [StarSystem]
}

struct Blob {
    let x: Double
    let y: Double
    let w: Int
    let h: Int
    let area: Int
}

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

let starmapData = try! Data(contentsOf: URL(fileURLWithPath: "static/data/starmap.json"))
let starmap = try! JSONDecoder().decode(StarMapFile.self, from: starmapData)
let systems = starmap.systems.filter { $0.id != 0 }
var byName: [String: StarSystem] = [:]
for s in systems { byName[s.name.uppercased()] = s }

func detectBlobs(path: String) -> [Blob] {
    guard let nsImg = NSImage(contentsOfFile: path),
          let cg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
    let w = cg.width
    let h = cg.height
    let bytesPerRow = w * 4
    var raw = [UInt8](repeating: 0, count: h * bytesPerRow)
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: &raw, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [] }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

    var visited = [Bool](repeating: false, count: w * h)
    var blobs: [Blob] = []

    @inline(__always) func isBright(_ idx: Int) -> Bool {
        let r = Int(raw[idx])
        let g = Int(raw[idx + 1])
        let b = Int(raw[idx + 2])
        return (r > 210 && g > 190 && b > 55) || (r > 165 && g > 230 && b > 230) || (r > 235 && g > 170 && b < 65)
    }
    @inline(__always) func isEdge(_ idx: Int) -> Bool {
        let r = Int(raw[idx])
        let g = Int(raw[idx + 1])
        let b = Int(raw[idx + 2])
        return (r > 180 && g > 160 && b > 35) || (r > 145 && g > 210 && b > 210) || (r > 210 && g > 145 && b < 65)
    }

    var qx = [Int](repeating: 0, count: 2500)
    var qy = [Int](repeating: 0, count: 2500)

    for y in stride(from: 58, to: h - 25, by: 2) {
        for x in stride(from: 15, to: w - 15, by: 2) {
            if x > 2220 && (y < 115 || y > 825) { continue }
            let vi = y * w + x
            if visited[vi] { continue }
            let pi = vi * 4
            if !isBright(pi) { continue }

            visited[vi] = true
            qx[0] = x
            qy[0] = y
            var head = 0
            var tail = 1
            var minX = x, maxX = x, minY = y, maxY = y
            var sumX = 0.0, sumY = 0.0

            while head < tail && tail < 2000 {
                let cx = qx[head]
                let cy = qy[head]
                head += 1
                sumX += Double(cx)
                sumY += Double(cy)
                if cx < minX { minX = cx }
                if cx > maxX { maxX = cx }
                if cy < minY { minY = cy }
                if cy > maxY { maxY = cy }

                let nbs = [(cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)]
                for (nx, ny) in nbs {
                    if nx >= 5 && nx < w - 5 && ny >= 50 && ny < h - 15 {
                        let nvi = ny * w + nx
                        if !visited[nvi] && isEdge(nvi * 4) {
                            visited[nvi] = true
                            if tail < 2000 {
                                qx[tail] = nx
                                qy[tail] = ny
                                tail += 1
                            }
                        }
                    }
                }
            }

            let count = tail
            if count >= 24 && count <= 1600 {
                let bw = maxX - minX + 1
                let bh = maxY - minY + 1
                let maxDim = max(bw, bh)
                if bw >= 5 && bw <= 44 && bh >= 5 && bh <= 44 && abs(bw - bh) <= max(5, Int(0.35 * Double(maxDim))) {
                    let fill = Double(count) / Double(bw * bh)
                    if fill >= 0.52 && fill <= 0.94 {
                        let mx = sumX / Double(count)
                        let my = sumY / Double(count)
                        let cpi = (Int(my.rounded()) * w + Int(mx.rounded())) * 4
                        if Int(raw[cpi]) > 175 && Int(raw[cpi + 1]) > 145 {
                            blobs.append(Blob(x: mx, y: my, w: bw, h: bh, area: count))
                        }
                    }
                }
            }
        }
    }
    return blobs
}

func refinePose(blobs: [Blob], initScale: Double, initTx: Double, initTy: Double) -> (Double, Double, Double, Int, Double) {
    var s = initScale
    var tx = initTx
    var ty = initTy
    var matchCount = 0
    var rms = 999.0

    for iter in 0..<5 {
        let thresh = iter < 2 ? 9.0 : 5.5
        var mX: [Double] = []
        var mY: [Double] = []
        var mPX: [Double] = []
        var mPY: [Double] = []
        var errSq = 0.0

        for sys in systems {
            let px = s * sys.x + tx
            let py = -s * sys.y + ty
            if px >= 15 && px <= 2530 && py >= 58 && py <= 895 {
                var bestD2 = thresh * thresh
                var bestB: Blob? = nil
                for b in blobs {
                    let dx = b.x - px
                    let dy = b.y - py
                    let d2 = dx*dx + dy*dy
                    if d2 < bestD2 {
                        bestD2 = d2
                        bestB = b
                    }
                }
                if let b = bestB {
                    mX.append(sys.x)
                    mY.append(sys.y)
                    mPX.append(b.x)
                    mPY.append(b.y)
                    errSq += bestD2
                }
            }
        }
        let n = mX.count
        matchCount = n
        if n < 4 { break }
        rms = sqrt(errSq / Double(n))
        let meanX = mX.reduce(0, +) / Double(n)
        let meanY = mY.reduce(0, +) / Double(n)
        let meanPX = mPX.reduce(0, +) / Double(n)
        let meanPY = mPY.reduce(0, +) / Double(n)
        var num = 0.0
        var den = 0.0
        for i in 0..<n {
            let dx = mX[i] - meanX
            let dy = mY[i] - meanY
            num += dx * (mPX[i] - meanPX) - dy * (mPY[i] - meanPY)
            den += dx * dx + dy * dy
        }
        if den > 1e-6 {
            s = num / den
            tx = meanPX - s * meanX
            ty = meanPY + s * meanY
        }
    }
    return (s, tx, ty, matchCount, rms)
}

func trackStep(blobs: [Blob], prevS: Double, prevTx: Double, prevTy: Double) -> (Double, Double, Double, Int, Double) {
    // World bounds visible in prev frame expanded by margin
    let wMinX = (0.0 - prevTx) / prevS - 180.0
    let wMaxX = (2546.0 - prevTx) / prevS + 180.0
    let wMinY = (prevTy - 934.0) / prevS - 180.0
    let wMaxY = (prevTy - 0.0) / prevS + 180.0
    let localSys = systems.filter { $0.x >= wMinX && $0.x <= wMaxX && $0.y >= wMinY && $0.y <= wMaxY }

    let alphas: [Double] = [1.0, 0.97, 1.03, 0.94, 1.06, 0.91, 1.09, 0.88, 1.12, 0.85, 1.15, 0.82, 1.18, 0.78, 1.22, 0.74, 1.26, 0.70, 1.32]
    var bestScore = -1
    var bestCand = (prevS, prevTx, prevTy)

    for a in alphas {
        let cs = prevS * a
        // Center-preserved tx, ty when zooming around screen center (1273, 467)
        let cxWorld = (1273.0 - prevTx) / prevS
        let cyWorld = (prevTy - 467.0) / prevS
        let expTx = 1273.0 - cs * cxWorld
        let expTy = 467.0 + cs * cyWorld

        var bins: [Int: (Int, Double, Double)] = [:]
        for sys in localSys {
            let ppx = cs * sys.x + expTx
            let ppy = -cs * sys.y + expTy
            if ppx < -450 || ppx > 2996 || ppy < -450 || ppy > 1384 { continue }
            for b in blobs {
                let dtx = b.x - ppx
                let dty = b.y - ppy
                if abs(dtx) <= 550 && abs(dty) <= 550 {
                    let txVal = b.x - cs * sys.x
                    let tyVal = b.y + cs * sys.y
                    let bx = Int(floor(txVal / 6.0))
                    let by = Int(floor(tyVal / 6.0))
                    let key = (bx & 0xFFFF) | ((by & 0xFFFF) << 16)
                    let cur = bins[key] ?? (0, 0.0, 0.0)
                    bins[key] = (cur.0 + 1, cur.1 + txVal, cur.2 + tyVal)
                }
            }
        }
        for (_, val) in bins {
            if val.0 > bestScore {
                bestScore = val.0
                bestCand = (cs, val.1 / Double(val.0), val.2 / Double(val.0))
            }
        }
    }
    return refinePose(blobs: blobs, initScale: bestCand.0, initTx: bestCand.1, initTy: bestCand.2)
}

let dir = "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps"
let files = (try! FileManager.default.contentsOfDirectory(atPath: dir)).filter { $0.hasSuffix(".png") }.sorted()
print("Detecting blobs across \(files.count) frames...")
var allBlobs: [[Blob]] = []
for f in files {
    allBlobs.append(detectBlobs(path: "\(dir)/\(f)"))
}

// Seed from frame 132 (t=22.00s): known exact scale=14.635, tx=-437.3, ty=-2784.2
let seedIdx = 132
let seed = refinePose(blobs: allBlobs[seedIdx], initScale: 14.635, initTx: -437.3, initTy: -2784.2)
print("Seed frame \(seedIdx) (\(files[seedIdx])): s=\(seed.0) tx=\(seed.1) ty=\(seed.2) matches=\(seed.3) rms=\(seed.4)")

var results = [Int: (Double, Double, Double, Int, Double)]()
results[seedIdx] = seed

// Track backward 131 down to 0
var cur = seed
for i in stride(from: seedIdx - 1, through: 0, by: -1) {
    cur = trackStep(blobs: allBlobs[i], prevS: cur.0, prevTx: cur.1, prevTy: cur.2)
    results[i] = cur
}

// Track forward 133 up to files.count - 1
cur = seed
for i in (seedIdx + 1)..<files.count {
    cur = trackStep(blobs: allBlobs[i], prevS: cur.0, prevTx: cur.1, prevTy: cur.2)
    results[i] = cur
}

var poses: [Pose] = []
var lowMatchFrames: [Int] = []
for i in 0..<files.count {
    let r = results[i]!
    let wcx = (1273.0 - r.1) / r.0
    let wcy = (r.2 - 467.0) / r.0
    poses.append(Pose(idx: i, file: files[i], scale: r.0, tx: r.1, ty: r.2, matches: r.3, rms: r.4, worldCenterX: wcx, worldCenterY: wcy))
    if r.3 < 10 || r.4 > 2.5 {
        lowMatchFrames.append(i)
    }
    if i % 12 == 0 || r.3 < 10 {
        print(String(format: "Frame %03d (%@): scale=%6.3f center=(%6.1f, %6.1f) matches=%3d rms=%.2fpx", i, files[i], r.0, wcx, wcy, r.3, r.4))
    }
}
print("Low match / high RMS frames (\(lowMatchFrames.count)): \(lowMatchFrames)")

let jsonOut = try! JSONEncoder().encode(poses)
try! jsonOut.write(to: URL(fileURLWithPath: "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json"))
