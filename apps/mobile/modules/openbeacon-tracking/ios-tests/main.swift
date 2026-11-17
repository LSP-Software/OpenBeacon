import Foundation

var failures = 0

func check(_ condition: @autoclosure () throws -> Bool, _ message: String, line: Int = #line) {
  let passed = (try? condition()) ?? false
  if !passed {
    failures += 1
    print("FAIL line \(line): \(message)")
  }
}

let vectorsPath = CommandLine.arguments[1]
let vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: vectorsPath))) as! [String: Any]
let constants = vectors["constants"] as! [String: String]
let epochKey = Data(base64Encoded: constants["epochKeyBase64"]!)!
let nonce = Data(base64Encoded: constants["nonceBase64"]!)!
let cases = vectors["cases"] as! [[String: Any]]

for testCase in cases {
  let name = testCase["name"] as! String
  let metadata = testCase["metadata"] as! [String: String]
  let plaintext = Data(base64Encoded: testCase["plaintextBase64"] as! String)!
  let encrypted = try GroupPayloadEncrypt.encrypt(
    epochKey: epochKey,
    plaintext: plaintext,
    groupId: metadata["groupId"]!,
    epochId: metadata["epochId"]!,
    kind: metadata["kind"]!,
    senderDeviceId: metadata["senderDeviceId"]!,
    nonce: nonce
  )
  check(encrypted.ciphertext == testCase["ciphertextBase64"] as! String, "\(name): ciphertext matches the shared vector")
  check(encrypted.nonce == testCase["nonceBase64"] as! String, "\(name): nonce matches the shared vector")
  check(
    String(decoding: GroupPayloadEncrypt.associatedData(
      groupId: metadata["groupId"]!,
      epochId: metadata["epochId"]!,
      kind: metadata["kind"]!,
      senderDeviceId: metadata["senderDeviceId"]!
    ), as: UTF8.self) == testCase["aadJson"] as! String,
    "\(name): associated data matches the shared vector"
  )
  check(try GroupPayloadEncrypt.decrypt(epochKey: epochKey, payload: encrypted) == plaintext, "\(name): decrypts back to the plaintext")

  let otherGroup = EncryptedGroupPayload(
    algorithm: encrypted.algorithm,
    ciphertext: encrypted.ciphertext,
    epochId: encrypted.epochId,
    groupId: "another-group",
    kind: encrypted.kind,
    nonce: encrypted.nonce,
    senderDeviceId: encrypted.senderDeviceId
  )
  check((try? GroupPayloadEncrypt.decrypt(epochKey: epochKey, payload: otherGroup)) == nil, "\(name): rejects a payload moved to another group")
}

let plaintextFor = { (name: String) in cases.first { $0["name"] as? String == name }!["plaintextJson"] as! String }
check(
  GroupPayloadEncrypt.trackingPointV1Json(latitude: 51.5074, longitude: -0.1278, timestamp: "2026-07-13T18:45:00.000Z", speed: 1.4, batteryLevel: 72, batteryCharging: false)
    == plaintextFor("tracking-point-with-speed"),
  "tracking point JSON matches the vector with speed"
)
check(
  GroupPayloadEncrypt.trackingPointV1Json(latitude: 51.5074, longitude: -0.1278, timestamp: "2026-07-13T18:45:00.000Z", speed: nil, batteryLevel: 5, batteryCharging: true)
    == plaintextFor("tracking-point-null-speed"),
  "tracking point JSON matches the vector without speed"
)
check(
  GroupPayloadEncrypt.trackingPointV1Json(latitude: 51.5074, longitude: -0.1278, timestamp: "2026-07-13T18:45:00.000Z", speed: nil, batteryLevel: nil, batteryCharging: false)
    == plaintextFor("tracking-point-unknown-battery-level"),
  "tracking point JSON matches the vector without a battery level"
)
check(
  GroupPayloadEncrypt.trackingPointV1Json(latitude: 1, longitude: 2, timestamp: "t", speed: .nan, batteryLevel: nil, batteryCharging: false)?.contains("\"speed\":null") == true,
  "non-finite speed is written as null"
)
check(GroupPayloadEncrypt.trackingPointV1Json(latitude: .infinity, longitude: 2, timestamp: "t", speed: nil, batteryLevel: nil, batteryCharging: false) == nil, "non-finite coordinates are refused")
check(formatTrackingTimestamp(1_783_968_300_000) == "2026-07-13T18:45:00.000Z", "timestamps use UTC with milliseconds")

let hChaChaKey = (0..<32).map { UInt8($0) }
let hChaChaNonce: [UInt8] = [0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x4A, 0x00, 0x00, 0x00, 0x00, 0x31, 0x41, 0x59, 0x27]
check(
  GroupPayloadEncrypt.hChaCha20(key: hChaChaKey, nonce: hChaChaNonce).map { String(format: "%02x", $0) }.joined()
    == "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc",
  "HChaCha20 matches the draft-irtf-cfrg-xchacha test vector"
)

let current = SharingCaptureState(revisionPrefix: "s2.3:", paused: true)
check(!SharingCaptureState(revisionPrefix: "s1.3:").isAtLeastAsRecentAs(current), "an older account revision can't replace a newer one")
check(!SharingCaptureState(revisionPrefix: "s2.2:").isAtLeastAsRecentAs(current), "an older device revision can't replace a newer one")
check(!SharingCaptureState().isAtLeastAsRecentAs(current), "an empty revision can't replace a known one")
check(SharingCaptureState(revisionPrefix: "s2.4:").isAtLeastAsRecentAs(current), "a newer revision replaces the current one")
check(!SharingCaptureState(paused: true).canCapture(timestamp: .max, now: .max), "an indefinite pause never captures")
check(SharingCaptureState(revisionPrefix: "s1.1:", paused: true).isConfirmedIndefinitePause, "a confirmed pause without an end is indefinite")
check(!SharingCaptureState(paused: true).isConfirmedIndefinitePause, "an unconfirmed pause isn't indefinite")
check(!SharingCaptureState(revisionPrefix: "s1.1:", paused: true, pausedUntil: 1000).isConfirmedIndefinitePause, "a timed pause isn't indefinite")
let timed = SharingCaptureState(paused: true, pausedUntil: 1000, resumeAfter: 1000)
check(!timed.canCapture(timestamp: 500, now: 999), "a timed pause blocks fixes before its end")
check(!timed.canCapture(timestamp: 1000, now: 2000), "a fix taken before the resume cutoff is dropped")
check(timed.canCapture(timestamp: 1001, now: 2000), "a fix after the resume cutoff is kept")

let home = PlaceGeofence(groupId: "group-1", placeId: "home", latitude: 51.5, longitude: -0.1, radiusMeters: 150)
let fix = { (detector: PlaceDwellDetector, metersNorth: Double, seconds: Int64) in
  detector.onFix(places: [home], latitude: home.latitude + metersNorth / 111_195.0, longitude: home.longitude, accuracyMeters: 10, timestampMillis: seconds * 1000)
}
let arriving = PlaceDwellDetector()
_ = fix(arriving, 1000, 0)
check(fix(arriving, 0, 30).isEmpty && fix(arriving, 0, 149).isEmpty, "arrival waits for two minutes inside")
check(fix(arriving, 0, 150) == [PlaceCrossing(place: home, arrived: true, occurredAt: 30_000)], "arrival is reported from when it first looked inside")
check(fix(arriving, 0, 180).isEmpty, "arrival is reported once")
let jitter = PlaceDwellDetector()
_ = fix(jitter, 0, 0)
let boundary: [Double] = [140, 170, 145, 190, 130, 175, 149, 160, 120, 200, 140]
check(boundary.enumerated().flatMap { fix(jitter, $0.element, Int64(30 * ($0.offset + 1))) }.isEmpty, "jitter at the boundary is absorbed")

let battery = BatterySnapshot(level: 80, charging: false, powerSaveMode: false, levelKnown: true)
let lowBattery = BatterySnapshot(level: 10, charging: false, powerSaveMode: false, levelKnown: true)
check(CaptureSamplingPolicy.evaluate(battery: battery, speedMetersPerSecond: 2, distanceFromLastQueuedMeters: 5, timeSinceLastQueuedMs: 1000).intervalMs == 10_000, "moving samples every 10 seconds")
check(CaptureSamplingPolicy.evaluate(battery: lowBattery, speedMetersPerSecond: nil, distanceFromLastQueuedMeters: 5, timeSinceLastQueuedMs: 1000).intervalMs == 60_000, "low battery samples every minute")
check(!CaptureSamplingPolicy.evaluate(battery: battery, speedMetersPerSecond: 0, distanceFromLastQueuedMeters: 5, timeSinceLastQueuedMs: 1000).shouldQueue, "a stationary phone skips nearby fixes")
check(CaptureSamplingPolicy.evaluate(battery: battery, speedMetersPerSecond: 0, distanceFromLastQueuedMeters: 5, timeSinceLastQueuedMs: 300_000).shouldQueue, "a stationary phone still queues every five minutes")

if failures > 0 {
  print("\(failures) iOS tracking core checks failed")
  exit(1)
}
print("iOS tracking core checks passed")
