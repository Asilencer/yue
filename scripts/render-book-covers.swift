import AppKit

private let canvasWidth = 768
private let canvasHeight = 1152

private struct Cover {
  let id: String
  let renderTypography: () -> Void
}

private func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
  NSColor(
    calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
    green: CGFloat((hex >> 8) & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255,
    alpha: alpha
  )
}

private func font(_ name: String, _ size: CGFloat) -> NSFont {
  NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size)
}

private func drawText(
  _ text: String,
  x: CGFloat,
  top: CGFloat,
  width: CGFloat,
  height: CGFloat,
  font: NSFont,
  color: NSColor,
  kern: CGFloat = 0,
  alignment: NSTextAlignment = .left
) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = alignment
  let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: color,
    .kern: kern,
    .paragraphStyle: paragraph,
  ]
  let rect = NSRect(
    x: x,
    y: CGFloat(canvasHeight) - top - height,
    width: width,
    height: height
  )
  NSAttributedString(string: text, attributes: attributes).draw(
    with: rect,
    options: [.usesLineFragmentOrigin, .usesFontLeading]
  )
}

private func drawVertical(
  _ text: String,
  x: CGFloat,
  top: CGFloat,
  step: CGFloat,
  font: NSFont,
  color: NSColor
) {
  for (index, character) in text.enumerated() {
    drawText(
      String(character),
      x: x,
      top: top + CGFloat(index) * step,
      width: font.pointSize * 1.35,
      height: font.pointSize * 1.35,
      font: font,
      color: color,
      alignment: .center
    )
  }
}

private let covers: [Cover] = [
  Cover(id: "lake") {
    let ink = color(0x26302e)
    drawText(
      "湖边散记",
      x: 342,
      top: 137,
      width: 366,
      height: 74,
      font: font("STSongti-SC-Regular", 50),
      color: ink,
      kern: 11,
      alignment: .right
    )
    drawText(
      "林望",
      x: 573,
      top: 226,
      width: 124,
      height: 38,
      font: font("PingFangSC-Regular", 20),
      color: color(0x52605c),
      kern: 12
    )
  },
  Cover(id: "spring") {
    drawVertical(
      "春日庭院",
      x: 78,
      top: 425,
      step: 78,
      font: font("STSongti-SC-Regular", 60),
      color: color(0xf2e5c9)
    )
    drawVertical(
      "许青禾",
      x: 198,
      top: 635,
      step: 36,
      font: font("STKaitiSC-Regular", 22),
      color: color(0x293329)
    )
  },
  Cover(id: "letters") {
    drawText(
      "薄暮书简",
      x: 294,
      top: 211,
      width: 420,
      height: 82,
      font: font("STSongti-SC-Regular", 53),
      color: color(0xf1e4ca),
      kern: 12
    )
    drawVertical(
      "周野",
      x: 649,
      top: 420,
      step: 38,
      font: font("STKaitiSC-Regular", 23),
      color: color(0xe8dcc6)
    )
  },
  Cover(id: "north") {
    let titleFont = font("PingFangSC-Regular", 64)
    drawText(
      "北方",
      x: 54,
      top: 66,
      width: 300,
      height: 82,
      font: titleFont,
      color: color(0x171817),
      kern: 8
    )
    drawText(
      "手札",
      x: 54,
      top: 141,
      width: 300,
      height: 82,
      font: titleFont,
      color: color(0x171817),
      kern: 8
    )
    drawVertical(
      "沈舟",
      x: 650,
      top: 112,
      step: 36,
      font: font("PingFangSC-Regular", 22),
      color: color(0x9c3329)
    )
  },
  Cover(id: "plants") {
    drawVertical(
      "寂静植物学",
      x: 534,
      top: 146,
      step: 69,
      font: font("STSongti-SC-Regular", 50),
      color: color(0x213d2e)
    )
    drawVertical(
      "简森",
      x: 642,
      top: 503,
      step: 34,
      font: font("PingFangSC-Regular", 20),
      color: color(0x49604b)
    )
  },
  Cover(id: "route") {
    let paper = color(0xf0e2bf)
    drawText(
      "微光",
      x: 52,
      top: 60,
      width: 370,
      height: 104,
      font: font("HiraginoSansGB-W3", 82),
      color: paper,
      kern: 5
    )
    drawText(
      "航线",
      x: 281,
      top: 161,
      width: 176,
      height: 54,
      font: font("HiraginoSansGB-W3", 35),
      color: color(0xb9c9c0),
      kern: 8
    )
    drawText(
      "陈屿",
      x: 287,
      top: 226,
      width: 142,
      height: 36,
      font: font("PingFangSC-Regular", 18),
      color: color(0x879f9a),
      kern: 11
    )
  },
  Cover(id: "notes") {
    drawVertical(
      "月下笔记",
      x: 584,
      top: 116,
      step: 72,
      font: font("STSongti-SC-Regular", 48),
      color: color(0xeee1c5)
    )
    drawVertical(
      "白榆",
      x: 635,
      top: 492,
      step: 31,
      font: font("STKaitiSC-Regular", 19),
      color: color(0xa9a99e)
    )
  },
  Cover(id: "distance") {
    let paper = color(0xf3e8cf)
    drawVertical(
      "远方来信",
      x: 623,
      top: 72,
      step: 70,
      font: font("HiraginoSansGB-W3", 48),
      color: paper
    )
    drawText(
      "陶然",
      x: 531,
      top: 1040,
      width: 168,
      height: 42,
      font: font("PingFangSC-Regular", 22),
      color: color(0x22221e),
      kern: 14,
      alignment: .right
    )
  },
]

private let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0])
  .standardizedFileURL
private let projectRoot = scriptURL
  .deletingLastPathComponent()
  .deletingLastPathComponent()
private let sourceDirectory = projectRoot
  .appendingPathComponent("src/assets/covers/backgrounds")
private let outputDirectory = projectRoot
  .appendingPathComponent("src/assets/covers")

for cover in covers {
  let sourceURL = sourceDirectory.appendingPathComponent("\(cover.id).jpg")
  let outputURL = outputDirectory.appendingPathComponent("\(cover.id)-cover.jpg")
  guard let background = NSImage(contentsOf: sourceURL) else {
    fatalError("无法读取封面底图：\(sourceURL.path)")
  }
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: canvasWidth,
    pixelsHigh: canvasHeight,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("无法创建封面画布：\(cover.id)")
  }
  bitmap.size = NSSize(width: canvasWidth, height: canvasHeight)
  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("无法创建封面绘图上下文：\(cover.id)")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  background.draw(
    in: NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight),
    from: .zero,
    operation: .copy,
    fraction: 1
  )
  cover.renderTypography()
  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  guard let data = bitmap.representation(
    using: .jpeg,
    properties: [.compressionFactor: 0.94]
  ) else {
    fatalError("无法导出封面：\(cover.id)")
  }
  try data.write(to: outputURL, options: .atomic)
  print(outputURL.path)
}

private let previewWidth = 820
private let previewHeight = 600
private let previewMargin = 20
private let previewCoverWidth = 180
private let previewCoverHeight = 270
guard let previewBitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: previewWidth,
  pixelsHigh: previewHeight,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fatalError("无法创建封面预览画布")
}
previewBitmap.size = NSSize(width: previewWidth, height: previewHeight)
guard let previewContext = NSGraphicsContext(bitmapImageRep: previewBitmap) else {
  fatalError("无法创建封面预览绘图上下文")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = previewContext
color(0xe9e8e3).setFill()
NSRect(x: 0, y: 0, width: previewWidth, height: previewHeight).fill()
for (index, cover) in covers.enumerated() {
  let column = index % 4
  let row = index / 4
  let x = previewMargin + column * (previewCoverWidth + previewMargin)
  let top = previewMargin + row * (previewCoverHeight + previewMargin)
  let y = previewHeight - top - previewCoverHeight
  let outputURL = outputDirectory.appendingPathComponent("\(cover.id)-cover.jpg")
  NSImage(contentsOf: outputURL)?.draw(
    in: NSRect(x: x, y: y, width: previewCoverWidth, height: previewCoverHeight),
    from: .zero,
    operation: .copy,
    fraction: 1
  )
}
previewContext.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

let previewURL = outputDirectory.appendingPathComponent("cover-sheet-preview.jpg")
guard let previewData = previewBitmap.representation(
  using: .jpeg,
  properties: [.compressionFactor: 0.92]
) else {
  fatalError("无法导出封面预览")
}
try previewData.write(to: previewURL, options: .atomic)
print(previewURL.path)
