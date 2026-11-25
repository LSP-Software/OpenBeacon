import Foundation

enum TrackingPointCodec {
  static let version: UInt8 = 2
  static let length = 23
  private static let unknownUInt16: UInt16 = 0xFFFF
  private static let unknownBatteryLevel: UInt8 = 127
  private static let stayFlag: UInt8 = 1
  private static let driveDetectionOffFlag: UInt8 = 2
  private static let crashAlertsOffFlag: UInt8 = 4
  private static let maxTimeMillis: Int64 = (1 << 48) - 1

  static func encode(
    latitude: Double,
    longitude: Double,
    timestampMillis: Int64,
    stayUntilMillis: Int64?,
    accuracyMeters: Double?,
    speedMetersPerSecond: Double?,
    batteryLevel: Int?,
    batteryCharging: Bool,
    driveDetectionOff: Bool = false,
    crashAlertsOff: Bool = false
  ) -> Data? {
    guard latitude.isFinite, latitude >= -90, latitude <= 90 else { return nil }
    guard longitude.isFinite, longitude >= -180, longitude <= 180 else { return nil }
    guard timestampMillis >= 0, timestampMillis <= maxTimeMillis else { return nil }

    let stayMinutes = stayUntilMillis.map { UInt16(min(max($0 - timestampMillis, 0) / 60_000, Int64(unknownUInt16))) } ?? 0
    let level = batteryLevel.map { UInt8(min(max($0, 0), 100)) } ?? unknownBatteryLevel

    var bytes = Data(capacity: length)
    bytes.append(version)
    append(&bytes, UInt32(bitPattern: Int32(javaRound(latitude * 1e7))))
    append(&bytes, UInt32(bitPattern: Int32(javaRound(longitude * 1e7))))
    append(&bytes, UInt16(truncatingIfNeeded: timestampMillis >> 32))
    append(&bytes, UInt32(truncatingIfNeeded: timestampMillis))
    append(&bytes, stayMinutes)
    append(&bytes, encodeUInt16(accuracyMeters, scale: 10))
    append(&bytes, encodeUInt16(speedMetersPerSecond, scale: 100))
    bytes.append((batteryCharging ? 0x80 : 0) | level)
    bytes.append((stayUntilMillis == nil ? 0 : stayFlag) | (driveDetectionOff ? driveDetectionOffFlag : 0) | (crashAlertsOff ? crashAlertsOffFlag : 0))
    return bytes
  }

  private static func encodeUInt16(_ value: Double?, scale: Double) -> UInt16 {
    guard let value, value.isFinite, value >= 0 else { return unknownUInt16 }
    return UInt16(min(javaRound(value * scale), Int64(unknownUInt16) - 1))
  }

  private static func javaRound(_ value: Double) -> Int64 {
    Int64((value + 0.5).rounded(.down))
  }

  private static func append<T: FixedWidthInteger>(_ data: inout Data, _ value: T) {
    withUnsafeBytes(of: value.bigEndian) { data.append(contentsOf: $0) }
  }
}
