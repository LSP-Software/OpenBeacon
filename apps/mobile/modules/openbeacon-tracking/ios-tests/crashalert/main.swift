import Foundation

var failures = 0

func check(_ condition: Bool, _ message: String) {
  if !condition {
    failures += 1
    print("FAIL: \(message)")
  }
}

let vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let bytes = { (hex: String) -> Data in
  let characters = Array(hex.utf8)
  return Data(stride(from: 0, to: characters.count, by: 2).map { UInt8(String(decoding: characters[$0..<$0 + 2], as: UTF8.self), radix: 16)! })
}
let hex = { (data: Data) in data.map { String(format: "%02x", $0) }.joined() }
let message = { (json: [String: Any]) -> CrashAlertMessage in
  let crash = json["crash"] as! [String: Any]
  return CrashAlertMessage(
    type: CrashAlertType(name: json["type"] as! String)!,
    messageId: json["messageId"] as! String,
    alertId: json["alertId"] as! String,
    crashTimeMillis: (crash["time"] as! NSNumber).int64Value,
    latitude: (crash["latitude"] as! NSNumber).doubleValue,
    longitude: (crash["longitude"] as! NSNumber).doubleValue,
    speedBefore: (crash["speedBefore"] as! NSNumber).doubleValue,
    sharingUntilMillis: (json["sharingUntil"] as! NSNumber).int64Value,
    okAtMillis: (json["okAt"] as? NSNumber)?.int64Value,
    placeLabel: json["placeLabel"] as? String
  )
}

check(CrashAlertCodec.length == (vectors["length"] as! NSNumber).intValue, "length matches the shared vectors")
check(CrashAlertCodec.encryptedLength == (vectors["encryptedLength"] as! NSNumber).intValue, "encrypted length matches the shared vectors")
for vector in vectors["encode"] as! [[String: Any]] {
  let name = vector["name"] as! String
  check(CrashAlertCodec.encode(message(vector["message"] as! [String: Any])).map(hex) == vector["hex"] as? String, "\(name): encodes to the shared bytes")
  check(CrashAlertCodec.decode(bytes(vector["hex"] as! String)) == message(vector["decoded"] as! [String: Any]), "\(name): decodes the shared bytes")
}
for vector in vectors["encodeReject"] as! [[String: Any]] {
  check(CrashAlertCodec.encode(message(vector["message"] as! [String: Any])) == nil, "\(vector["name"] as! String): refused when encoding")
}
for vector in vectors["decodeReject"] as! [[String: Any]] {
  check(CrashAlertCodec.decode(bytes(vector["hex"] as! String)) == nil, "\(vector["name"] as! String): refused when decoding")
}

if failures > 0 {
  print("\(failures) crash alert check(s) failed")
  exit(1)
}
print("Crash alert codec checks passed")
