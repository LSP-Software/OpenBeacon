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

let pointVectors = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))) as! [String: Any]
let hex = { (data: Data) in data.map { String(format: "%02x", $0) }.joined() }
let encodePoint = { (point: [String: Any]) -> Data? in
  let battery = point["battery"] as! [String: Any]
  return TrackingPointCodec.encode(
    latitude: (point["latitude"] as! NSNumber).doubleValue,
    longitude: (point["longitude"] as! NSNumber).doubleValue,
    timestampMillis: (point["time"] as! NSNumber).int64Value,
    stayUntilMillis: (point["stayUntil"] as? NSNumber)?.int64Value,
    accuracyMeters: (point["accuracy"] as? NSNumber)?.doubleValue,
    speedMetersPerSecond: (point["speed"] as? NSNumber)?.doubleValue,
    batteryLevel: (battery["level"] as? NSNumber)?.intValue,
    batteryCharging: battery["charging"] as! Bool,
    driveDetectionOff: point["driveDetectionOff"] as? Bool ?? false
  )
}
let encodeVectors = pointVectors["encode"] as! [[String: Any]]
for vector in encodeVectors {
  let encoded = encodePoint(vector["point"] as! [String: Any])
  check(encoded.map(hex) == vector["hex"] as? String, "tracking point \(vector["name"]!): encodes to the shared bytes")
  check(encoded?.count == TrackingPointCodec.length, "tracking point \(vector["name"]!): is \(TrackingPointCodec.length) bytes")
}
for vector in pointVectors["encodeReject"] as! [[String: Any]] {
  check(encodePoint(vector["point"] as! [String: Any]) == nil, "tracking point \(vector["name"]!): is refused")
}
for testCase in cases {
  let point = encodeVectors.first { $0["name"] as? String == testCase["trackingPoint"] as? String }!["point"] as! [String: Any]
  check(encodePoint(point)?.base64EncodedString() == testCase["plaintextBase64"] as? String, "\(testCase["name"]!): plaintext is the v2 tracking point")
}
check(
  GroupPayloadEncrypt.clientPointId(epochKey: epochKey, parts: ["a", "b"], byteCount: 8) == GroupPayloadEncrypt.clientPointId(epochKey: epochKey, parts: ["a", "b"], byteCount: 8)
    && Data(base64Encoded: GroupPayloadEncrypt.clientPointId(epochKey: epochKey, parts: ["a", "b"], byteCount: 8))?.count == 8,
  "stay point IDs are stable and 8 bytes"
)

let driveVectors = try runDriveRecordCodecChecks(vectorsPath: CommandLine.arguments[3]) { check($0, $1) }
let driveSealed = driveVectors["sealed"] as! [String: Any]
let driveKey = Data(stride(from: 0, to: 64, by: 2).map { UInt8(String(Array(driveSealed["epochKeyHex"] as! String)[$0..<$0 + 2]), radix: 16)! })
let driveNonce = Data(stride(from: 0, to: 48, by: 2).map { UInt8(String(Array(driveSealed["nonceHex"] as! String)[$0..<$0 + 2]), radix: 16)! })
for testCase in driveSealed["cases"] as! [[String: Any]] {
  let metadata = testCase["metadata"] as! [String: String]
  let hexRecord = (driveVectors["encode"] as! [[String: Any]]).first { $0["name"] as? String == testCase["name"] as? String }!["hex"] as! String
  let source = DriveRecordCodec.decode(Data(stride(from: 0, to: hexRecord.count, by: 2).map { UInt8(String(Array(hexRecord)[$0..<$0 + 2]), radix: 16)! }))!
  let sealed = try DriveRecordSeal.seal(record: source, epochKey: driveKey, groupId: metadata["groupId"]!, epochId: metadata["epochId"]!, senderDeviceId: metadata["senderDeviceId"]!, nonce: driveNonce)
  check(sealed?.ciphertext == testCase["ciphertextBase64"] as? String, "sealed drive \(testCase["name"]!): ciphertext matches the shared vector")
  check(sealed?.startHour == (testCase["startHour"] as! NSNumber).int64Value, "sealed drive \(testCase["name"]!): is filed by its start hour")
  check(sealed.flatMap { DriveRecordSeal.open($0, epochKey: driveKey, groupId: metadata["groupId"]!, epochId: metadata["epochId"]!, senderDeviceId: metadata["senderDeviceId"]!) } == source, "sealed drive \(testCase["name"]!): opens back to the record")
  check(sealed.flatMap { DriveRecordSeal.open($0, epochKey: driveKey, groupId: "another-group", epochId: metadata["epochId"]!, senderDeviceId: metadata["senderDeviceId"]!) } == nil, "sealed drive \(testCase["name"]!): is unreadable in another group")
}

let filterStart: Int64 = 1_783_965_600_000
let northMeters = { (north: Double) in 51.5 + north / 111_195.0 }
let eastMeters = { (east: Double) in -0.1 + east / (111_195.0 * cos(51.5 * Double.pi / 180)) }
let historyFix = { (time: Int64, east: Double, north: Double, speed: Double) in
  HistoryFix(latitude: northMeters(north), longitude: eastMeters(east), timestampMillis: time, accuracyMeters: 8, speedMetersPerSecond: speed, batteryLevel: 80, batteryCharging: false)
}
let track = { (steps: Range<Int>, position: (Int) -> (Double, Double, Double)) in
  steps.map { step -> HistoryFix in
    let (east, north, speed) = position(step)
    return historyFix(filterStart + Int64(step) * 10_000, east, north, speed)
  }
}
let jitterMeters = { (seed: Int) in Double((seed * 7_919) % 13 - 6) }
let runFilter = { (filter: HistoryFilter, fixes: [HistoryFix]) in fixes.flatMap { filter.onFix($0) { true } } }
let gaps = { (records: [HistoryRecord]) in zip(records, records.dropFirst()).map { $1.fix.timestampMillis - $0.fix.timestampMillis } }

let walk = runFilter(HistoryFilter(), track(0..<60) { (Double($0) * 14, 0, 1.4) })
check(walk.first?.fix.timestampMillis == filterStart && walk.count <= 7 && gaps(walk).allSatisfy { $0 <= 120_000 }, "a straight walk keeps only the points the maximum gap needs")
let drive = runFilter(HistoryFilter(), track(0..<60) { (Double($0) * 310, 0, 31) })
check(gaps(drive).allSatisfy { (30_000...40_000).contains($0) }, "faster travel shortens the maximum gap")

let bend = track(0..<4) { $0 < 3 ? (Double($0) * 14, 0, 1.4) : (28, 40, 1.4) }
let bendFilter = HistoryFilter()
check(bendFilter.onFix(bend[0]) { true }.map(\.fix) == [bend[0]], "the first fix is kept")
check(bendFilter.onFix(bend[1]) { true }.isEmpty && bendFilter.onFix(bend[2]) { true }.isEmpty, "fixes on a straight line wait")
check(bendFilter.onFix(bend[3]) { true }.map(\.fix) == [bend[2]], "a broken line keeps the previous fix one fix late")

let walkIn = track(0..<6) { (Double($0) * 14, 0, 1.4) }
let stillFixes = track(6..<66) { (70 + jitterMeters($0), jitterMeters($0 + 7), 0) }.map { fix -> HistoryFix in
  var moved = fix
  moved.timestampMillis = filterStart + 60_000 + (fix.timestampMillis - filterStart - 60_000) * 2
  return moved
}
let leftAt = stillFixes.last!.timestampMillis
let walkOut = (1...12).map { historyFix(leftAt + Int64($0) * 10_000, 70 + Double($0) * 20, 0, 2) }
let stayRecords = runFilter(HistoryFilter(), walkIn + stillFixes + walkOut)
let stays = stayRecords.filter { $0.stayUntil != nil }
check(stays.count >= 4 && Set(stays.map(\.fix.timestampMillis)).count == 1, "a stay saves one arrival and updates it")
check(zip(stays, stays.dropFirst()).allSatisfy { $1.stayUntil! > $0.stayUntil! }, "each stay update moves its until time forward")
check(stays.last?.stayUntil == walkOut[1].timestampMillis, "leaving closes the stay once the phone is clearly outside")
check(stayRecords.last?.stayUntil == nil && stayRecords.last!.fix.timestampMillis > walkOut[1].timestampMillis, "the route resumes after leaving")
check(PlaceDwellDetector.distanceMeters(stays.last!.fix.latitude, stays.last!.fix.longitude, northMeters(0), eastMeters(70)) < 5, "the stay is placed at the average position")

let longStay = (0..<30).map { historyFix(filterStart + 40 * 60_000 + Int64($0) * 300_000, jitterMeters($0), jitterMeters($0 + 3), 0) }
let longStayParts = Dictionary(grouping: runFilter(HistoryFilter(), longStay).filter { $0.stayUntil != nil }, by: \.fix.timestampMillis)
  .mapValues { $0.last! }.sorted { $0.key < $1.key }.map(\.value)
check(longStayParts.map(\.fix.timestampMillis) == [filterStart + 40 * 60_000, filterStart + 3_600_000, filterStart + 7_200_000, filterStart + 10_800_000], "a long stay is split at each UTC hour")
check(longStayParts.dropLast().map(\.stayUntil) == [filterStart + 3_600_000, filterStart + 7_200_000, filterStart + 10_800_000], "each part of a stay ends at the hour the next one starts")

let silent = track(0..<20) { (jitterMeters($0), jitterMeters($0 + 3), 0) }.map { fix -> HistoryFix in
  var spaced = fix
  spaced.timestampMillis = filterStart + (fix.timestampMillis - filterStart) * 3
  return spaced
}
let silenceFilter = HistoryFilter()
check(runFilter(silenceFilter, silent).contains { $0.stayUntil != nil }, "sitting still starts a stay")
let afterGap = historyFix(silent.last!.timestampMillis + 3_600_000, 0, 0, 0)
let resumed = silenceFilter.onFix(afterGap) { true }
check(resumed.first?.stayUntil == silent.last!.timestampMillis && resumed.last?.fix == afterGap && resumed.last?.stayUntil == nil, "a long silence ends the stay so history shows a gap")

let orderFilter = HistoryFilter()
let firstFix = historyFix(filterStart, 0, 0, 1)
check(orderFilter.onFix(firstFix) { true }.count == 1, "the first fix is kept")
var inaccurate = firstFix
inaccurate.timestampMillis += 500_000
inaccurate.accuracyMeters = 500
inaccurate.latitude = 10
check(orderFilter.onFix(inaccurate) { true }.isEmpty, "an inaccurate fix is ignored")
var older = firstFix
older.timestampMillis -= 1
check(orderFilter.onFix(older) { true }.isEmpty, "an out-of-order fix is ignored")

let zigzag = track(0..<40) { (Double($0) * 14, $0 % 2 == 0 ? 0 : 30, 1.4) }
let budgetFilter = HistoryFilter()
var tokens = 1
let take = { () -> Bool in
  guard tokens > 0 else { return false }
  tokens -= 1
  return true
}
check(zigzag.flatMap { budgetFilter.onFix($0, takeAllowance: take) }.map(\.fix) == [zigzag[0]], "an empty allowance keeps nothing more")
tokens = 1
let afterBudget = historyFix(zigzag.last!.timestampMillis + 10_000, 40 * 14, 0, 1.4)
check(budgetFilter.onFix(afterBudget, takeAllowance: take).map(\.fix) == [afterBudget], "the next token starts the route again at the current fix")

let historySettings = HistoryFilterSettings()
var allowance = HistoryAllowance.full(now: 0, settings: historySettings)
for _ in 0..<historySettings.dailyAllowance { allowance = allowance.take(now: 0, settings: historySettings)! }
check(allowance.take(now: 0, settings: historySettings) == nil, "the daily allowance runs out")
check(allowance.take(now: 29_999, settings: historySettings) == nil && allowance.take(now: 30_000, settings: historySettings) != nil, "the allowance refills one point every thirty seconds")

let midStill = track(0..<80) { (jitterMeters($0), jitterMeters($0 + 5), 0) }
let midWalkOut = (1...6).map { historyFix(midStill.last!.timestampMillis + Int64($0) * 10_000, Double($0) * 25, 0, 2.5) }
let midBefore = HistoryFilter()
let midArrival = runFilter(midBefore, Array(midStill.prefix(40))).filter { $0.stayUntil != nil }
let (midAfter, midClosing) = midBefore.handOver { true }
check(midArrival.count == 1 && midClosing.map(\.fix.timestampMillis) == [midArrival[0].fix.timestampMillis] && midClosing.map(\.stayUntil) == [midStill[39].timestampMillis], "handing over mid-stay closes the old stream's stay at its last fix")
let midRecords = runFilter(midAfter, Array(midStill.dropFirst(40)) + midWalkOut)
let midStays = midRecords.filter { $0.stayUntil != nil }
check(midStays.first?.fix.timestampMillis == midStill[40].timestampMillis && midStays.first?.stayUntil == midStill[40].timestampMillis, "the new stream starts its stay at the next fix")
check(Set(midStays.map(\.fix.timestampMillis)) == [midStill[40].timestampMillis] && midStays.last?.stayUntil == midWalkOut[1].timestampMillis, "the new stream's stay closes on leaving")
check(!midRecords.contains { $0.fix.timestampMillis < midStill[40].timestampMillis }, "the new stream sends nothing from before the hand-over")

let leavingStill = track(0..<40) { (jitterMeters($0), jitterMeters($0 + 5), 0) }
let leavingWalkOut = (1...6).map { historyFix(leavingStill.last!.timestampMillis + Int64($0) * 10_000, 100 + Double($0) * 25, 0, 2.5) }
let leavingBefore = HistoryFilter()
_ = runFilter(leavingBefore, leavingStill)
let (leavingAfter, leavingClosing) = leavingBefore.handOver { true }
check(leavingClosing.count == 1 && leavingClosing[0].stayUntil == leavingStill.last!.timestampMillis, "the old stream closes its stay")
let leavingRecords = runFilter(leavingAfter, leavingWalkOut)
check(!leavingRecords.contains { $0.stayUntil != nil } && leavingRecords.first?.fix == leavingWalkOut[0], "leaving straight after a hand-over sends no stay in the new stream")

let sentStill = track(0..<19) { (jitterMeters($0), jitterMeters($0 + 5), 0) }
let sentBefore = HistoryFilter()
check(runFilter(sentBefore, sentStill).last?.stayUntil == sentStill.last!.timestampMillis && sentBefore.handOver { true }.1.isEmpty, "a stay already sent up to its last fix hands over without another record")

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
let unconfirmedPause = SharingCaptureState(paused: true)
check(unconfirmedPause.canReplace(SharingCaptureState(revisionPrefix: "s2.3:"), confirmedRevision: "s2.3:"), "an unconfirmed pause always applies")
check(!SharingCaptureState(revisionPrefix: "s1.1:").canReplace(unconfirmedPause, confirmedRevision: "s2.3:"), "an older resume can't follow an unconfirmed pause")
check(SharingCaptureState(revisionPrefix: "s2.4:").canReplace(unconfirmedPause, confirmedRevision: "s2.3:"), "a newer resume replaces an unconfirmed pause")
check(SharingCaptureState(revisionPrefix: "s1.1:").canReplace(SharingCaptureState(), confirmedRevision: ""), "the first confirmed state applies")
let upgraded = SharingCaptureState(revisionPrefix: "s2.3:")
let seeded = SharingCaptureState.confirmedRevision(stored: nil, current: upgraded)
let afterPause = unconfirmedPause.confirmedRevision(replacing: seeded)
check(seeded == "s2.3:" && afterPause == "s2.3:", "an upgraded phone seeds the confirmed revision from its current one and an unconfirmed pause keeps it")
check(!SharingCaptureState(revisionPrefix: "s1.1:").canReplace(unconfirmedPause, confirmedRevision: SharingCaptureState.confirmedRevision(stored: afterPause, current: unconfirmedPause)), "an older resume can't follow an unconfirmed pause after upgrading")
check(SharingCaptureState(revisionPrefix: "s2.4:").confirmedRevision(replacing: "s2.3:") == "s2.4:", "a confirmed state becomes the confirmed revision")
check(!SharingCaptureState(paused: true).canCapture(timestamp: .max, now: .max), "an indefinite pause never captures")
check(SharingCaptureState(revisionPrefix: "s1.1:", paused: true).isConfirmedIndefinitePause, "a confirmed pause without an end is indefinite")
check(!SharingCaptureState(paused: true).isConfirmedIndefinitePause, "an unconfirmed pause isn't indefinite")
check(!SharingCaptureState(revisionPrefix: "s1.1:", paused: true, pausedUntil: 1000).isConfirmedIndefinitePause, "a timed pause isn't indefinite")
let timed = SharingCaptureState(paused: true, pausedUntil: 1000, resumeAfter: 1000)
check(!timed.canCapture(timestamp: 500, now: 999), "a timed pause blocks fixes before its end")
check(!timed.canCapture(timestamp: 1000, now: 2000), "a fix taken before the resume cutoff is dropped")
check(timed.canCapture(timestamp: 1001, now: 2000), "a fix after the resume cutoff is kept")

let home = PlaceGeofence(groupId: "group-1", placeId: "home", latitude: 51.5, longitude: -0.1, radiusMeters: 150)
let placeFix = { (detector: PlaceDwellDetector, metersNorth: Double, seconds: Int64, accuracy: Double, speed: Double?) in
  detector.onFix(places: [home], latitude: home.latitude + metersNorth / 111_195.0, longitude: home.longitude, accuracyMeters: accuracy, timestampMillis: seconds * 1000, speedMetersPerSecond: speed)
}
let fix = { (detector: PlaceDwellDetector, metersNorth: Double, seconds: Int64) in placeFix(detector, metersNorth, seconds, 10, nil) }
let arriving = PlaceDwellDetector()
_ = fix(arriving, 1000, 0)
check(placeFix(arriving, 0, 30, 10, 0.2).isEmpty && arriving.isConfirming(nowMillis: 30_000) && placeFix(arriving, 0, 60, 10, 0.2).isEmpty, "a clear arrival waits 45 seconds")
check(placeFix(arriving, 0, 75, 10, 0.2) == [PlaceCrossing(place: home, arrived: true, occurredAt: 30_000)], "arrival is reported from when it first looked inside")
check(fix(arriving, 0, 90).isEmpty && !arriving.isConfirming(nowMillis: 90_000), "arrival is reported once")
let unclear = PlaceDwellDetector()
_ = fix(unclear, 1000, 0)
check(placeFix(unclear, 100, 30, 80, nil).isEmpty && placeFix(unclear, 100, 149, 80, nil).isEmpty, "an unclear arrival waits for two minutes inside")
check(placeFix(unclear, 100, 150, 80, nil).count == 1, "an unclear arrival is reported after two minutes")
let walking = PlaceDwellDetector()
_ = fix(walking, 1000, 0)
check(stride(from: Int64(10), through: 110, by: 10).flatMap { placeFix(walking, 0, $0, 10, 1.4) }.isEmpty, "walking through a place is not a quick arrival")
let lights = PlaceDwellDetector()
_ = fix(lights, 1000, 0)
check(placeFix(lights, 0, 10, 10, 12).isEmpty && stride(from: Int64(20), through: 60, by: 10).flatMap { placeFix(lights, 0, $0, 10, 0) }.isEmpty && placeFix(lights, 0, 70, 10, 8).isEmpty, "a short stop at lights inside a place is not an arrival")
let leaving = PlaceDwellDetector()
_ = fix(leaving, 0, 0)
check(placeFix(leaving, 500, 60, 10, 12).isEmpty && placeFix(leaving, 500, 80, 10, 12).isEmpty, "a clear departure waits 30 seconds")
check(placeFix(leaving, 800, 90, 10, 12) == [PlaceCrossing(place: home, arrived: false, occurredAt: 60_000)], "a clear departure is reported after 30 seconds of moving away")
let jump = PlaceDwellDetector()
_ = fix(jump, 0, 0)
check(fix(jump, 400, 60).isEmpty && fix(jump, 400, 170).isEmpty && fix(jump, 400, 180).count == 1, "a jump outside without a speed waits two minutes")
let band = PlaceDwellDetector()
_ = fix(band, 0, 0)
_ = fix(band, 185, 30)
check(stride(from: Int64(40), through: 300, by: 10).flatMap { fix(band, 165, $0) }.isEmpty && band.isConfirming(nowMillis: 149_000) && !band.isConfirming(nowMillis: 150_000), "confirming stops after two minutes without a clear fix")
let jitter = PlaceDwellDetector()
_ = fix(jitter, 0, 0)
let boundary: [Double] = [140, 170, 145, 190, 130, 175, 149, 160, 120, 200, 140]
check(boundary.enumerated().flatMap { fix(jitter, $0.element, Int64(30 * ($0.offset + 1))) }.isEmpty, "jitter at the boundary is absorbed")

let battery = BatterySnapshot(level: 80, charging: false, powerSaveMode: false, levelKnown: true)
let lowBattery = BatterySnapshot(level: 10, charging: false, powerSaveMode: false, levelKnown: true)
let decide = { (snapshot: BatterySnapshot, speed: Double?, accuracy: Double?, distance: Double, elapsedMs: Int64) in
  CaptureSamplingPolicy.evaluate(battery: snapshot, speedMetersPerSecond: speed, accuracyMeters: accuracy, distanceFromLastQueuedMeters: distance, timeSinceLastQueuedMs: elapsedMs)
}
check(decide(battery, 2, 5, 5, 1000).intervalMs == 10_000, "moving samples every 10 seconds")
check(CaptureSamplingPolicy.evaluate(battery: battery, speedMetersPerSecond: 0, accuracyMeters: 5, distanceFromLastQueuedMeters: 0, timeSinceLastQueuedMs: 30_000, confirmingPlace: true).intervalMs == 10_000, "a still phone confirming a place samples every 10 seconds")
check(decide(lowBattery, nil, nil, 5, 1000).intervalMs == 60_000, "low battery samples every minute")
check(!decide(battery, 0, 5, 5, 1000).shouldQueue, "a stationary phone skips nearby fixes")
check(decide(battery, 0, 5, 5, 300_000).shouldQueue, "a stationary phone still queues every five minutes")
let uploadIntervalMs = { (speed: Double?, lowPowerMode: Bool) in
  CaptureSamplingPolicy.evaluate(battery: battery, speedMetersPerSecond: speed, accuracyMeters: 5, distanceFromLastQueuedMeters: 5, timeSinceLastQueuedMs: 1000, lowPowerMode: lowPowerMode).uploadIntervalMs
}
check(uploadIntervalMs(nil, false) == 60_000 && uploadIntervalMs(0.4, false) == 60_000, "a phone that isn't moving uploads once a minute")
check(decide(battery, 0.6, 5, 5, 10_000).intervalMs == 10_000, "a slow walk counts as moving")
check(decide(battery, nil, nil, 40, 30_000).intervalMs == 10_000, "a fix without a speed counts as moving once the phone has covered the distance")
check(decide(battery, nil, nil, 20, 30_000).intervalMs == 30_000, "a fix without a speed that stayed close is not moving")
check(decide(battery, nil, nil, 40, 300_000).intervalMs == 30_000, "a fix without a speed that covered the distance too slowly is not moving")
check(decide(battery, 1.2, 35, 5, 30_000).intervalMs == 30_000 && decide(battery, 1.2, nil, 5, 30_000).intervalMs == 30_000, "a speed from a poor fix is ignored")
check(decide(battery, 1.2, 20, 5, 30_000).intervalMs == 10_000 && decide(battery, 1.2, 8, 5, 30_000).intervalMs == 10_000, "a speed from a good fix counts")
check(decide(battery, 0.1, 30, 60, 30_000).intervalMs == 10_000 && decide(battery, 0.1, 30, 60, 30_000).uploadIntervalMs == 55_000, "a poor fix still counts as moving once the phone has covered the distance")
check(decide(battery, nil, 30, 40, 30_000).intervalMs == 30_000 && decide(battery, nil, 5, 40, 30_000).intervalMs == 10_000, "a coarse fix that jumped within its accuracy is not moving")
check(decide(battery, 0.5, 5, 5, 10_000).intervalMs == 10_000 && decide(battery, 0.49, 5, 5, 10_000).intervalMs == 30_000, "moving starts exactly at the speed threshold")
check(decide(battery, nil, nil, 25, 50_000).intervalMs == 10_000 && decide(battery, nil, nil, 24.9, 50_000).intervalMs == 30_000, "moving starts exactly at the distance threshold")
check(uploadIntervalMs(1.4, false) == 55_000 && uploadIntervalMs(5, false) == 15_000, "a moving phone uploads more often the faster it goes")
check(uploadIntervalMs(10, false) == 5_000 && uploadIntervalMs(31, false) == 5_000, "a fast phone uploads with every fix")
let fixTimes: [Int64] = (1...12).map { Int64($0) * 9_900 }
let uploadTimes = { (speed: Double) -> [Int64] in
  let interval = uploadIntervalMs(speed, false)
  return Array(fixTimes.reduce([Int64(0)]) { uploads, fix in fix - uploads.last! >= interval ? uploads + [fix] : uploads }.dropFirst())
}
check(uploadTimes(13) == fixTimes, "a fast phone uploads with the fix nearest its due time")
check(uploadTimes(5.5) == [19_800, 39_600, 59_400, 79_200, 99_000, 118_800], "a moving phone uploads with the fix nearest its due time")
check(uploadTimes(1.4) == [59_400, 118_800], "a walking phone uploads with the fix nearest a minute")
check(uploadIntervalMs(31, true) == 55_000 && uploadIntervalMs(1.4, true) == 55_000, "low power mode uploads with the fix nearest a minute at any speed")
check(uploadIntervalMs(0, true) == 60_000, "low power mode uploads once a minute when still")
check(decide(battery, nil, nil, 40, 30_000).uploadIntervalMs == 55_000, "a phone moving by distance uploads with the fix nearest a minute")
check(decide(lowBattery, 31, 5, 5, 1000).uploadIntervalMs == 120_000, "battery saver keeps the slowest upload rate")
check(decide(lowBattery, nil, nil, 40, 30_000).intervalMs == 20_000 && decide(lowBattery, nil, nil, 40, 30_000).uploadIntervalMs == 120_000, "battery saver keeps the slowest upload rate while moving by distance")

let historyShare = CaptureHistoryShare(account: "LAST_LOCATION", groups: ["family": "MAXIMUM", "club": "LAST_LOCATION"])
check(!historyShare.isLiveOnly("family"), "a group's own history choice beats the account setting")
check(historyShare.isLiveOnly("club"), "a group set to last location only queues no history")
check(historyShare.isLiveOnly("new-group"), "a group with no choice of its own follows the account setting")
check(!CaptureHistoryShare().isLiveOnly("new-group"), "the default shares history")

if failures > 0 {
  print("\(failures) iOS tracking core checks failed")
  exit(1)
}
print("iOS tracking core checks passed")
