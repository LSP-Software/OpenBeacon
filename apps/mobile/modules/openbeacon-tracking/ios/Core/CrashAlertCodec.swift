import Foundation

enum CrashAlertType: Int {
  case crash = 1
  case ok = 2

  init?(name: String) {
    switch name {
    case "CRASH": self = .crash
    case "OK": self = .ok
    default: return nil
    }
  }
}

struct CrashAlertMessage: Equatable {
  var type: CrashAlertType
  var messageId: String
  var alertId: String
  var crashTimeMillis: Int64
  var latitude: Double
  var longitude: Double
  var speedBefore: Double
  var sharingUntilMillis: Int64
  var okAtMillis: Int64?
  var placeLabel: String?
}

enum CrashAlertCodec {
  static let kind = "crash"
  static let version: UInt8 = 1
  static let length = 128
  static let encryptedLength = length + 16
  static let placeLabelBytes = 64
  private static let labelOffset = 63
  private static let maxTimeMillis: Int64 = (1 << 48) - 1

  static func encode(_ message: CrashAlertMessage) -> Data? {
    guard
      let messageId = idBytes(message.messageId),
      let alertId = idBytes(message.alertId),
      (message.type == .crash) == (message.okAtMillis == nil),
      message.type != .crash || message.alertId == message.messageId,
      message.speedBefore.isFinite,
      message.latitude.isFinite, abs(message.latitude) <= 90,
      message.longitude.isFinite, abs(message.longitude) <= 180,
      (0...maxTimeMillis).contains(message.crashTimeMillis),
      (0...maxTimeMillis).contains(message.sharingUntilMillis)
    else { return nil }
    let speed = javaRound(message.speedBefore * 100)
    guard speed >= 0, speed <= 0xFFFF else { return nil }
    if let okAt = message.okAtMillis, okAt <= 0 || okAt > maxTimeMillis { return nil }
    let label = labelBytes(message.placeLabel ?? "")
    var data = Data()
    data.append(version)
    data.append(UInt8(message.type.rawValue))
    data.append(contentsOf: messageId)
    data.append(contentsOf: alertId)
    appendUInt48(&data, message.crashTimeMillis)
    append(&data, Int32(javaRound(message.latitude * 1e7)))
    append(&data, Int32(javaRound(message.longitude * 1e7)))
    append(&data, UInt16(speed))
    appendUInt48(&data, message.sharingUntilMillis)
    appendUInt48(&data, message.okAtMillis ?? 0)
    data.append(UInt8(label.count))
    data.append(contentsOf: label)
    data.append(contentsOf: [UInt8](repeating: 0, count: length - data.count))
    return data
  }

  static func decode(_ data: Data) -> CrashAlertMessage? {
    let bytes = [UInt8](data)
    guard bytes.count == length, bytes[0] == version, let type = CrashAlertType(rawValue: Int(bytes[1])) else { return nil }
    let labelLength = Int(bytes[62])
    let latitude = Int32(bitPattern: uint32(bytes, 40))
    let longitude = Int32(bitPattern: uint32(bytes, 44))
    let okAt = uint48(bytes, 56)
    let messageId = hex(bytes[2..<18])
    let alertId = hex(bytes[18..<34])
    guard
      labelLength <= placeLabelBytes,
      abs(Int64(latitude)) <= 900_000_000,
      abs(Int64(longitude)) <= 1_800_000_000,
      (type == .crash) == (okAt == 0),
      type != .crash || alertId == messageId,
      bytes[(labelOffset + labelLength)...].allSatisfy({ $0 == 0 }),
      let label = String(bytes: bytes[labelOffset..<labelOffset + labelLength], encoding: .utf8)
    else { return nil }
    return CrashAlertMessage(
      type: type,
      messageId: messageId,
      alertId: alertId,
      crashTimeMillis: uint48(bytes, 34),
      latitude: Double(latitude) / 1e7,
      longitude: Double(longitude) / 1e7,
      speedBefore: Double(UInt16(bytes[48]) << 8 | UInt16(bytes[49])) / 100,
      sharingUntilMillis: uint48(bytes, 50),
      okAtMillis: okAt == 0 ? nil : okAt,
      placeLabel: label.isEmpty ? nil : label
    )
  }

  private static func labelBytes(_ label: String) -> [UInt8] {
    var scalars = Array(label.unicodeScalars)
    while true {
      var view = String.UnicodeScalarView()
      view.append(contentsOf: scalars)
      let bytes = Array(String(view).utf8)
      if bytes.count <= placeLabelBytes { return bytes }
      scalars.removeLast()
    }
  }

  private static func idBytes(_ id: String) -> [UInt8]? {
    let characters = Array(id.utf8)
    guard characters.count == 32, characters.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return nil }
    return stride(from: 0, to: 32, by: 2).map { UInt8(String(decoding: characters[$0..<$0 + 2], as: UTF8.self), radix: 16)! }
  }

  private static func hex(_ bytes: ArraySlice<UInt8>) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  private static func uint32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    bytes[offset..<offset + 4].reduce(0) { $0 << 8 | UInt32($1) }
  }

  private static func uint48(_ bytes: [UInt8], _ offset: Int) -> Int64 {
    bytes[offset..<offset + 6].reduce(0) { $0 << 8 | Int64($1) }
  }

  private static func javaRound(_ value: Double) -> Int64 {
    Int64((value + 0.5).rounded(.down))
  }

  private static func appendUInt48(_ data: inout Data, _ value: Int64) {
    append(&data, UInt16(truncatingIfNeeded: value >> 32))
    append(&data, UInt32(truncatingIfNeeded: value))
  }

  private static func append<T: FixedWidthInteger>(_ data: inout Data, _ value: T) {
    withUnsafeBytes(of: value.bigEndian) { data.append(contentsOf: $0) }
  }
}
