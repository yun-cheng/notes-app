// Draws the dev build's app icon for the Mac and iPhone: the web's public/icon.svg on amber rather than green, so a build
// from Xcode ("Notes Dev") is told apart from the released app beside it.
// Run from the repo: `swift scripts/dev-icon.swift`; it writes apple/Notes/Assets.xcassets/AppIconDev.appiconset.
import AppKit

let out = URL(fileURLWithPath: "apple/Notes/Assets.xcassets/AppIconDev.appiconset")
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func color(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

// icon.svg's shapes, in its 512-unit box: x, y, width, height, corner radius, color. Only the background differs.
let shapes: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, UInt32)] = [
    (0, 0, 512, 512, 0, 0xB45309),
    (176, 118, 214, 276, 26, 0x8FBDB4),
    (122, 150, 214, 276, 26, 0xF7F4EE),
    (160, 204, 138, 20, 10, 0x1F5C57),
    (160, 256, 138, 14, 7, 0x9AA9A4),
    (160, 296, 104, 14, 7, 0x9AA9A4),
]

for size in [16, 32, 64, 128, 256, 512, 1024] {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let k = CGFloat(size) / 512
    // The SVG's y runs down; Core Graphics' runs up.
    ctx.translateBy(x: 0, y: CGFloat(size))
    ctx.scaleBy(x: k, y: -k)
    for (x, y, w, h, r, c) in shapes {
        ctx.setFillColor(color(c))
        ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil))
        ctx.fillPath()
    }
    let png = NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
    try png.write(to: out.appendingPathComponent("icon-\(size).png"))
}

// The same slots as AppIcon's.
let contents = out.appendingPathComponent("Contents.json")
try? FileManager.default.removeItem(at: contents)
try FileManager.default.copyItem(at: URL(fileURLWithPath: "apple/Notes/Assets.xcassets/AppIcon.appiconset/Contents.json"), to: contents)
print("Wrote \(out.path)")
