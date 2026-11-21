// Read a pairing URL from stdin so the capability never appears in the process list.
import CoreImage
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let message = FileHandle.standardInput.readDataToEndOfFile()
guard !message.isEmpty, message.count < 1024, let filter = CIFilter(name: "CIQRCodeGenerator") else { exit(1) }
filter.setValue(message, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
guard let qr = filter.outputImage,
      let image = CIContext().createCGImage(qr, from: qr.extent) else { exit(1) }
let margin = 4, scale = 8
let size = (image.width + 2 * margin) * scale
guard let canvas = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                             bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
                             bitmapInfo: CGImageAlphaInfo.none.rawValue) else { exit(1) }
canvas.setFillColor(gray: 1, alpha: 1)
canvas.fill(CGRect(x: 0, y: 0, width: size, height: size))
canvas.interpolationQuality = .none
canvas.draw(image, in: CGRect(x: margin * scale, y: margin * scale, width: image.width * scale, height: image.height * scale))
let output = NSMutableData()
guard let finished = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, finished, nil)
guard CGImageDestinationFinalize(destination) else { exit(1) }
FileHandle.standardOutput.write(output as Data)
