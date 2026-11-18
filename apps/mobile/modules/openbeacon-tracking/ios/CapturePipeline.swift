import Foundation

final class CapturePipeline {
  static let shared = CapturePipeline()

  private struct Stream: Hashable {
    let owner: String
    let groupId: String
    let epochId: String
    let senderDeviceId: String
    let kind: String
    let revisionPrefix: String
  }

  private static let pointIdBytes = 8
  private static let allowanceDefaultsKey = "openbeacon_tracking_history_allowance"

  private let settings = HistoryFilterSettings()
  private var filters: [Stream: HistoryFilter] = [:]
  private var allowances: [[String]: HistoryAllowance] = [:]
  private var previousStreams: [Stream: ProvisionedEpochKey] = [:]
  private var previousRevocations: Int64 = 0

  func onFix(
    _ fix: HistoryFix,
    live: Bool,
    isCurrent: () -> Bool
  ) throws -> (inserted: Int, currentFixQueued: Bool) {
    guard let owner = TrackingRuntime.locked({ isCurrent() ? TrackingRuntime.queueOwner() : nil }) else { return (0, false) }
    let (revocations, keys) = TrackingRuntime.epochKeys.listWithRevocations()
    if keys.isEmpty {
      TrackingRuntime.locked { previousStreams = [:] }
      return (0, false)
    }
    guard fix.latitude.isFinite, fix.longitude.isFinite else { return (0, false) }

    let captureId = UUID().uuidString.lowercased()
    let queuedAt = TrackingRuntime.nowMillis()
    let planned: (sharing: SharingCaptureState, rows: [(ProvisionedEpochKey, HistoryRecord, String)])? = TrackingRuntime.locked {
      guard isCurrent(), TrackingRuntime.queueOwner() == owner else { return nil }
      let sharing = TrackingRuntime.sharingState()
      guard sharing.canCapture(timestamp: fix.timestampMillis, now: queuedAt) else { return nil }
      var streams: [Stream: ProvisionedEpochKey] = [:]
      for key in keys {
        streams[Stream(owner: owner, groupId: key.groupId, epochId: key.epochId, senderDeviceId: key.senderDeviceId, kind: key.kind, revisionPrefix: sharing.revisionPrefix)] = key
      }
      var rows: [(ProvisionedEpochKey, HistoryRecord, String)] = []
      if revocations == previousRevocations {
        for (stream, key) in previousStreams where streams[stream] == nil {
          guard let filter = filters[stream] else { continue }
          let next = streams.keys.first { candidate in
            filters[candidate] == nil
              && candidate.owner == stream.owner && candidate.groupId == stream.groupId && candidate.senderDeviceId == stream.senderDeviceId
              && candidate.kind == stream.kind && candidate.revisionPrefix == stream.revisionPrefix
          }
          guard let next else { continue }
          let (carried, records) = filter.handOver { takeAllowance([owner, stream.groupId], now: queuedAt) }
          filters[next] = carried
          rows += records.map { (key, $0, CiphertextQueueRow.roleStay) }
        }
      }
      previousStreams = streams
      previousRevocations = revocations
      filters = filters.filter { streams[$0.key] != nil }
      for (stream, key) in streams {
        let filter = filters[stream] ?? HistoryFilter(settings: settings)
        filters[stream] = filter
        let records = filter.onFix(fix) { takeAllowance([owner, key.groupId], now: queuedAt) }
        rows += records.map { (key, $0, $0.stayUntil == nil ? CiphertextQueueRow.rolePoint : CiphertextQueueRow.roleStay) }
        if live && !records.contains(where: { $0.stayUntil == nil && $0.fix == fix }) {
          rows.append((key, HistoryRecord(fix: fix), CiphertextQueueRow.roleLive))
        }
      }
      return (sharing, rows)
    }
    guard let planned, !planned.rows.isEmpty else { return (0, false) }

    var currentFixEncoded = false
    let rows: [CiphertextQueueRow] = try planned.rows.compactMap { key, record, role in
      let point = record.fix
      guard
        let plaintext = TrackingPointCodec.encode(
          latitude: point.latitude,
          longitude: point.longitude,
          timestampMillis: point.timestampMillis,
          stayUntilMillis: record.stayUntil,
          accuracyMeters: point.accuracyMeters,
          speedMetersPerSecond: point.speedMetersPerSecond,
          batteryLevel: point.batteryLevel,
          batteryCharging: point.batteryCharging
        )
      else { return nil }
      if role == CiphertextQueueRow.roleLive || (role == CiphertextQueueRow.rolePoint && point == fix) { currentFixEncoded = true }
      let encrypted = try GroupPayloadEncrypt.encrypt(
        epochKey: key.epochKey,
        plaintext: plaintext,
        groupId: key.groupId,
        epochId: key.epochId,
        kind: key.kind,
        senderDeviceId: key.senderDeviceId
      )
      let clientPointId =
        role == CiphertextQueueRow.roleStay
        ? GroupPayloadEncrypt.clientPointId(
          epochKey: key.epochKey,
          parts: ["openbeacon.tracking-point-id.v1", owner, key.groupId, key.epochId, key.senderDeviceId, key.kind, "arrival-time", String(point.timestampMillis), role],
          byteCount: Self.pointIdBytes
        )
        : GroupPayloadEncrypt.randomBytes(Self.pointIdBytes).base64EncodedString()
      return CiphertextQueueRow(
        owner: owner,
        clientPointId: planned.sharing.revisionPrefix + clientPointId,
        captureId: captureId,
        groupId: encrypted.groupId,
        epochId: encrypted.epochId,
        senderDeviceId: encrypted.senderDeviceId,
        kind: encrypted.kind,
        algorithm: encrypted.algorithm,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        queuedAt: queuedAt,
        role: role,
        capturedHour: role == CiphertextQueueRow.roleLive ? nil : Int64((Double(point.timestampMillis) / 3_600_000).rounded(.down))
      )
    }

    return try TrackingRuntime.locked {
      guard isCurrent(), TrackingRuntime.queueOwner() == owner else { return (0, false) }
      let sharing = TrackingRuntime.sharingState()
      guard sharing == planned.sharing, sharing.canCapture(timestamp: fix.timestampMillis, now: TrackingRuntime.nowMillis()) else { return (0, false) }
      let inserted = try TrackingDatabase.shared().insertCiphertexts(rows)
      return (inserted, inserted > 0 && currentFixEncoded)
    }
  }

  private func takeAllowance(_ group: [String], now: Int64) -> Bool {
    let current = allowances[group] ?? Self.loadAllowance(group) ?? HistoryAllowance.full(now: now, settings: settings)
    let next = current.take(now: now, settings: settings)
    allowances[group] = next ?? current.refill(now: now, settings: settings)
    if let next { Self.saveAllowance(group, next) }
    return next != nil
  }

  private static func allowanceKey(_ group: [String]) -> String {
    group.map { $0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "|", with: "\\|") }.joined(separator: "|")
  }

  private static func loadAllowance(_ group: [String]) -> HistoryAllowance? {
    let stored = UserDefaults.standard.dictionary(forKey: allowanceDefaultsKey)?[allowanceKey(group)] as? [String: Any]
    guard let tokens = stored?["tokens"] as? Double, tokens.isFinite, let updatedAt = (stored?["updatedAt"] as? NSNumber)?.int64Value else { return nil }
    return HistoryAllowance(tokens: tokens, updatedAt: updatedAt)
  }

  private static func saveAllowance(_ group: [String], _ allowance: HistoryAllowance) {
    var all = UserDefaults.standard.dictionary(forKey: allowanceDefaultsKey) ?? [:]
    all[allowanceKey(group)] = ["tokens": allowance.tokens, "updatedAt": NSNumber(value: allowance.updatedAt)]
    UserDefaults.standard.set(all, forKey: allowanceDefaultsKey)
  }

  static func clearAllowances(owner: String) {
    TrackingRuntime.locked {
      shared.allowances = shared.allowances.filter { $0.key.first != owner }
      guard var all = UserDefaults.standard.dictionary(forKey: allowanceDefaultsKey) else { return }
      let prefix = allowanceKey([owner]) + "|"
      all = all.filter { !$0.key.hasPrefix(prefix) }
      UserDefaults.standard.set(all, forKey: allowanceDefaultsKey)
    }
  }
}
