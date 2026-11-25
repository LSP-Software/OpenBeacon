import Foundation

enum DrivingEventType: Int, CaseIterable {
  case hardBraking = 1
  case rapidAcceleration = 2
  case speeding = 3
  case phoneUse = 4

  init?(name: String) {
    switch name {
    case "HARD_BRAKING": self = .hardBraking
    case "RAPID_ACCELERATION": self = .rapidAcceleration
    case "SPEEDING": self = .speeding
    case "PHONE_USE": self = .phoneUse
    default: return nil
    }
  }
}

enum SpeedLimitSource: Int {
  case posted = 1
  case roadType = 2

  init?(name: String) {
    switch name {
    case "POSTED": self = .posted
    case "ROAD_TYPE": self = .roadType
    default: return nil
    }
  }
}

struct SpeedLimit: Equatable {
  var speed: Double
  var source: SpeedLimitSource
}

struct DrivePosition: Equatable {
  var timeMillis: Int64
  var latitude: Double
  var longitude: Double
}

struct DrivingEvent: Equatable {
  var type: DrivingEventType
  var timeOffsetSeconds: Double
  var durationSeconds: Double
  var latitude: Double
  var longitude: Double
  var peak: Double
  var limit: SpeedLimit?
}

struct DriveRecord: Equatable {
  var driveId: String
  var start: DrivePosition
  var end: DrivePosition
  var distanceMeters: Double
  var checkedDistanceMeters: Double
  var durationSeconds: Double
  var topSpeed: Double
  var averageSpeed: Double
  var utcOffsetMinutes: Int
  var counts: [DrivingEventType: Int]
  var passenger: Bool
  var speedLimitsChecked: Bool
  var tellGroup: Bool
  var events: [DrivingEvent]
}

enum DriveRecordCodec {
  static let kind = "drive"
  static let version: UInt8 = 1
  static let length = 1_008
  static let encryptedLength = length + 16
  static let maxEvents = 48
  private static let headerLength = 73
  private static let eventLength = 16
  private static let passengerFlag: UInt8 = 1
  private static let speedLimitsCheckedFlag: UInt8 = 2
  private static let tellGroupFlag: UInt8 = 4
  private static let fullTurnE7: Int64 = 3_600_000_000
  private static let halfTurnE7: Int64 = 1_800_000_000
  private static let int24Max: Int64 = 0x7F_FFFF
  private static let maxTimeMillis: Int64 = (1 << 48) - 1

  static func markPassenger(_ record: DriveRecord) -> DriveRecord {
    var marked = record
    marked.passenger = true
    marked.counts = Dictionary(uniqueKeysWithValues: DrivingEventType.allCases.map { ($0, 0) })
    marked.events = []
    return marked
  }

  static func encode(_ record: DriveRecord) -> Data? {
    guard record.driveId.utf8.count == 32, record.driveId.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }), let idBytes = hexBytes(record.driveId) else { return nil }
    guard record.end.timeMillis >= record.start.timeMillis, abs(record.utcOffsetMinutes) <= 1_080 else { return nil }
    guard record.start.timeMillis >= 0, record.end.timeMillis <= maxTimeMillis else { return nil }
    let events = Array(record.events.prefix(maxEvents))
    var counts: [UInt16] = []
    for type in DrivingEventType.allCases {
      let count = record.counts[type] ?? 0
      guard count >= events.filter({ $0.type == type }).count, count <= 0xFFFF, !(record.passenger && count > 0) else { return nil }
      counts.append(UInt16(count))
    }
    guard !(record.passenger && !events.isEmpty) else { return nil }
    guard let start = e7(record.start.latitude, record.start.longitude), let end = e7(record.end.latitude, record.end.longitude) else { return nil }
    guard
      let distance = units(record.distanceMeters, 1, 0xFFFF_FFFF),
      let checked = units(record.checkedDistanceMeters, 1, 0xFFFF_FFFF),
      let duration = units(record.durationSeconds, 1, 0xFFFF_FFFF),
      let top = units(record.topSpeed, 100, 0xFFFF),
      let average = units(record.averageSpeed, 100, 0xFFFF)
    else { return nil }

    var bytes = Data(capacity: length)
    bytes.append(version)
    bytes.append(contentsOf: idBytes)
    bytes.append((record.passenger ? passengerFlag : 0) | (record.speedLimitsChecked ? speedLimitsCheckedFlag : 0) | (record.tellGroup ? tellGroupFlag : 0))
    appendUInt48(&bytes, record.start.timeMillis)
    appendUInt48(&bytes, record.end.timeMillis)
    append(&bytes, UInt32(bitPattern: start.0))
    append(&bytes, UInt32(bitPattern: start.1))
    append(&bytes, UInt32(bitPattern: end.0))
    append(&bytes, UInt32(bitPattern: end.1))
    append(&bytes, UInt32(distance))
    append(&bytes, UInt32(checked))
    append(&bytes, UInt32(duration))
    append(&bytes, UInt16(top))
    append(&bytes, UInt16(average))
    append(&bytes, UInt16(bitPattern: Int16(record.utcOffsetMinutes)))
    counts.forEach { append(&bytes, $0) }
    bytes.append(UInt8(events.count))
    for event in events {
      guard event.limit == nil || event.type == .speeding else { return nil }
      guard
        let position = e7(event.latitude, event.longitude),
        let timeOffset = units(event.timeOffsetSeconds, 1, 0xFF_FFFF),
        let eventDuration = units(event.durationSeconds, 1, 0xFFFF),
        let peak = units(event.peak, 100, 0xFFFF),
        let latitudeDelta = delta(start.0, position.0),
        let longitudeDelta = delta(start.1, position.1)
      else { return nil }
      let limit = event.limit.map { units($0.speed, 100, 0xFFFF) } ?? 0
      guard let limit else { return nil }
      bytes.append(UInt8(event.type.rawValue) | UInt8((event.limit?.source.rawValue ?? 0) << 4))
      appendInt24(&bytes, timeOffset)
      append(&bytes, UInt16(eventDuration))
      appendInt24(&bytes, latitudeDelta)
      appendInt24(&bytes, longitudeDelta)
      append(&bytes, UInt16(peak))
      append(&bytes, UInt16(limit))
    }
    bytes.append(Data(repeating: 0, count: length - bytes.count))
    return bytes
  }

  static func decode(_ data: Data) -> DriveRecord? {
    guard data.count == length else { return nil }
    let bytes = [UInt8](data)
    let uint16 = { (offset: Int) -> Int64 in Int64(bytes[offset]) << 8 | Int64(bytes[offset + 1]) }
    let uint24 = { (offset: Int) -> Int64 in Int64(bytes[offset]) << 16 | uint16(offset + 1) }
    let int24 = { (offset: Int) -> Int64 in
      let value = uint24(offset)
      return value > int24Max ? value - 0x100_0000 : value
    }
    let uint32 = { (offset: Int) -> Int64 in uint16(offset) << 16 | uint16(offset + 2) }
    let int32 = { (offset: Int) -> Int64 in Int64(Int32(bitPattern: UInt32(uint32(offset)))) }
    let flags = bytes[17]
    let eventCount = Int(bytes[72])
    let passenger = flags & passengerFlag != 0
    let counts = (0..<4).map { Int(uint16(64 + $0 * 2)) }
    let startTime = uint16(18) << 32 | uint32(20)
    let endTime = uint16(24) << 32 | uint32(26)
    let offset = Int(Int16(bitPattern: UInt16(uint16(62))))
    let startLatitude = int32(30)
    let startLongitude = int32(34)
    guard
      bytes[0] == version,
      flags & ~(passengerFlag | speedLimitsCheckedFlag | tellGroupFlag) == 0,
      eventCount <= maxEvents,
      endTime >= startTime,
      abs(offset) <= 1_080,
      !(passenger && (eventCount > 0 || counts.contains { $0 > 0 })),
      bytes[(headerLength + eventCount * eventLength)...].allSatisfy({ $0 == 0 })
    else { return nil }
    let validPosition = { (latitude: Int64, longitude: Int64) in abs(latitude) <= 900_000_000 && abs(longitude) <= halfTurnE7 }
    guard validPosition(startLatitude, startLongitude), validPosition(int32(38), int32(42)) else { return nil }

    var events: [DrivingEvent] = []
    for index in 0..<eventCount {
      let at = headerLength + index * eventLength
      guard let type = DrivingEventType(rawValue: Int(bytes[at] & 0x0F)) else { return nil }
      let source = Int(bytes[at] >> 4)
      let limit = uint16(at + 14)
      guard source <= 2, (source == 0) == (limit == 0), source == 0 || type == .speeding else { return nil }
      let latitude = startLatitude + int24(at + 6) * 100
      let longitude = wrapLongitude(startLongitude + int24(at + 9) * 100)
      guard validPosition(latitude, longitude) else { return nil }
      events.append(DrivingEvent(
        type: type,
        timeOffsetSeconds: Double(uint24(at + 1)),
        durationSeconds: Double(uint16(at + 4)),
        latitude: Double(latitude) / 1e7,
        longitude: Double(longitude) / 1e7,
        peak: Double(uint16(at + 12)) / 100,
        limit: SpeedLimitSource(rawValue: source).map { SpeedLimit(speed: Double(limit) / 100, source: $0) }
      ))
    }
    for type in DrivingEventType.allCases where counts[type.rawValue - 1] < events.filter({ $0.type == type }).count {
      return nil
    }

    return DriveRecord(
      driveId: bytes[1..<17].map { String(format: "%02x", $0) }.joined(),
      start: DrivePosition(timeMillis: startTime, latitude: Double(startLatitude) / 1e7, longitude: Double(startLongitude) / 1e7),
      end: DrivePosition(timeMillis: endTime, latitude: Double(int32(38)) / 1e7, longitude: Double(int32(42)) / 1e7),
      distanceMeters: Double(uint32(46)),
      checkedDistanceMeters: Double(uint32(50)),
      durationSeconds: Double(uint32(54)),
      topSpeed: Double(uint16(58)) / 100,
      averageSpeed: Double(uint16(60)) / 100,
      utcOffsetMinutes: offset,
      counts: Dictionary(uniqueKeysWithValues: DrivingEventType.allCases.map { ($0, counts[$0.rawValue - 1]) }),
      passenger: passenger,
      speedLimitsChecked: flags & speedLimitsCheckedFlag != 0,
      tellGroup: flags & tellGroupFlag != 0,
      events: events
    )
  }

  private static func hexBytes(_ hex: String) -> [UInt8]? {
    let characters = Array(hex.utf8)
    guard characters.count % 2 == 0 else { return nil }
    var bytes: [UInt8] = []
    for index in stride(from: 0, to: characters.count, by: 2) {
      guard let byte = UInt8(String(decoding: characters[index..<index + 2], as: UTF8.self), radix: 16) else { return nil }
      bytes.append(byte)
    }
    return bytes
  }

  private static func units(_ value: Double, _ scale: Double, _ max: Int64) -> Int64? {
    guard value.isFinite else { return nil }
    let result = javaRound(value * scale)
    guard result >= 0, result <= max else { return nil }
    return result
  }

  private static func e7(_ latitude: Double, _ longitude: Double) -> (Int32, Int32)? {
    guard latitude.isFinite, latitude >= -90, latitude <= 90, longitude.isFinite, longitude >= -180, longitude <= 180 else { return nil }
    return (Int32(javaRound(latitude * 1e7)), Int32(javaRound(longitude * 1e7)))
  }

  private static func wrapLongitude(_ value: Int64) -> Int64 {
    if value > halfTurnE7 { return value - fullTurnE7 }
    if value < -halfTurnE7 { return value + fullTurnE7 }
    return value
  }

  private static func delta(_ from: Int32, _ to: Int32) -> Int64? {
    let result = javaRound(Double(wrapLongitude(Int64(to) - Int64(from))) / 100)
    return abs(result) <= int24Max ? result : nil
  }

  private static func javaRound(_ value: Double) -> Int64 {
    Int64((value + 0.5).rounded(.down))
  }

  private static func appendUInt48(_ data: inout Data, _ value: Int64) {
    append(&data, UInt16(truncatingIfNeeded: value >> 32))
    append(&data, UInt32(truncatingIfNeeded: value))
  }

  private static func appendInt24(_ data: inout Data, _ value: Int64) {
    let unsigned = UInt32(truncatingIfNeeded: value) & 0xFF_FFFF
    data.append(contentsOf: [UInt8(unsigned >> 16), UInt8(unsigned >> 8 & 0xFF), UInt8(unsigned & 0xFF)])
  }

  private static func append<T: FixedWidthInteger>(_ data: inout Data, _ value: T) {
    withUnsafeBytes(of: value.bigEndian) { data.append(contentsOf: $0) }
  }
}
