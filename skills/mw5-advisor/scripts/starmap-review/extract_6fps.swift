import AVFoundation
import AppKit
import CoreGraphics

let path = "/Users/yasihusain/Desktop/Screen Recording 2026-11-23 at 11.44.39\u{202f}AM.mov"
let url = URL(fileURLWithPath: path)
let asset = AVURLAsset(url: url)

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

let outDir = "/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let step = 1.0 / 6.0
var t = 0.0
var idx = 0
while t <= 43.35 {
    let cm = CMTime(seconds: t, preferredTimescale: 600)
    var actual = CMTime.zero
    if let cg = try? gen.copyCGImage(at: cm, actualTime: &actual) {
        let rep = NSBitmapImageRep(cgImage: cg)
        if let png = rep.representation(using: .png, properties: [:]) {
            let fn = String(format: "%@/f_%03d_t%05.2f.png", outDir, idx, CMTimeGetSeconds(actual))
            try? png.write(to: URL(fileURLWithPath: fn))
        }
    }
    t += step
    idx += 1
}
print("Extracted \(idx) frames at 6fps")
