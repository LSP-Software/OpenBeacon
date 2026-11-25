import Foundation

func runDriveRecordCodecChecks(vectorsPath: String, check: (Bool, String) -> Void) throws -> [String: Any] {
  let vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: vectorsPath))) as! [String: Any]
  let hex = { (data: Data) in data.map { String(format: "%02x", $0) }.joined() }
  let bytes = { (hex: String) -> Data in
    let characters = Array(hex.utf8)
    return Data(stride(from: 0, to: characters.count, by: 2).map { UInt8(String(decoding: characters[$0..<$0 + 2], as: UTF8.self), radix: 16)! })
  }
  let number = { (value: Any?) in (value as! NSNumber).doubleValue }
  let position = { (json: [String: Any]) in
    DrivePosition(timeMillis: (json["time"] as! NSNumber).int64Value, latitude: number(json["latitude"]), longitude: number(json["longitude"]))
  }
  let record = { (json: [String: Any]) -> DriveRecord in
    let counts = json["counts"] as! [String: NSNumber]
    return DriveRecord(
      driveId: json["driveId"] as! String,
      start: position(json["start"] as! [String: Any]),
      end: position(json["end"] as! [String: Any]),
      distanceMeters: number(json["distance"]),
      checkedDistanceMeters: number(json["checkedDistance"]),
      durationSeconds: number(json["duration"]),
      topSpeed: number(json["topSpeed"]),
      averageSpeed: number(json["averageSpeed"]),
      utcOffsetMinutes: (json["utcOffsetMinutes"] as! NSNumber).intValue,
      counts: Dictionary(uniqueKeysWithValues: counts.map { (DrivingEventType(name: $0.key)!, $0.value.intValue) }),
      passenger: json["passenger"] as! Bool,
      speedLimitsChecked: json["speedLimitsChecked"] as! Bool,
      tellGroup: json["tellGroup"] as! Bool,
      events: (json["events"] as! [[String: Any]]).map { event in
        DrivingEvent(
          type: DrivingEventType(name: event["type"] as! String)!,
          timeOffsetSeconds: number(event["timeOffset"]),
          durationSeconds: number(event["duration"]),
          latitude: number(event["latitude"]),
          longitude: number(event["longitude"]),
          peak: number(event["peak"]),
          limit: (event["limit"] as? [String: Any]).map { SpeedLimit(speed: number($0["speed"]), source: SpeedLimitSource(name: $0["source"] as! String)!) }
        )
      }
    )
  }

  check(DriveRecordCodec.length == (vectors["length"] as! NSNumber).intValue, "drive record: length matches the shared vectors")
  check(DriveRecordCodec.encryptedLength == (vectors["encryptedLength"] as! NSNumber).intValue, "drive record: encrypted length matches the shared vectors")
  let encode = vectors["encode"] as! [[String: Any]]
  for vector in encode {
    let name = vector["name"] as! String
    let encoded = DriveRecordCodec.encode(record(vector["record"] as! [String: Any]))
    check(encoded.map(hex) == vector["hex"] as? String, "drive record \(name): encodes to the shared bytes")
    check(DriveRecordCodec.decode(bytes(vector["hex"] as! String)) == record(vector["decoded"] as! [String: Any]), "drive record \(name): decodes to the shared record")
  }
  for vector in vectors["encodeReject"] as! [[String: Any]] {
    check(DriveRecordCodec.encode(record(vector["record"] as! [String: Any])) == nil, "drive record \(vector["name"]!): is refused")
  }
  for vector in vectors["decodeReject"] as! [[String: Any]] {
    check(DriveRecordCodec.decode(bytes(vector["hex"] as! String)) == nil, "drive record \(vector["name"]!): bytes are refused")
  }
  let withEvents = record(encode.first { $0["name"] as? String == "with-events" }!["record"] as! [String: Any])
  for count in [0, 1, 48, 200] {
    var sized = withEvents
    sized.events = (0..<count).map { index in
      var event = withEvents.events[0]
      event.timeOffsetSeconds = Double(index * 5)
      return event
    }
    sized.counts = [.hardBraking: count, .rapidAcceleration: 0, .speeding: 0, .phoneUse: 0]
    check(DriveRecordCodec.encode(sized)?.count == DriveRecordCodec.length, "drive record: \(count) events keep the fixed size")
  }
  let passenger = record(encode.first { $0["name"] as? String == "passenger" }!["record"] as! [String: Any])
  check(DriveRecordCodec.encode(DriveRecordCodec.markPassenger(withEvents)) == DriveRecordCodec.encode(passenger), "drive record: a passenger mark blanks events and counts and keeps the summary")
  return vectors
}
