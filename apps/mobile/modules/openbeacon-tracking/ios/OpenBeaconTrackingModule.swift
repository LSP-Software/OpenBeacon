import ExpoModulesCore
import UIKit

public class OpenBeaconTrackingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBeaconTracking")

    Events("onSync")

    OnStartObserving {
      TrackingRuntime.setSyncListener { [weak self] reason in
        self?.sendEvent("onSync", ["reason": reason])
      }
    }

    OnStopObserving {
      TrackingRuntime.setSyncListener(nil)
    }

    Function("setHistoryShare") { (owner: String, deviceId: String, account: String, groups: [String: String]) -> Bool in
      TrackingRuntime.setHistoryShare(owner: owner, deviceId: deviceId, account: account, groups: groups)
    }

    Function("setSharingState") { (owner: String, deviceId: String, prefix: String, paused: Bool, until: Double?, after: Double?) -> Bool in
      TrackingRuntime.applySharingState(
        owner: owner,
        deviceId: deviceId,
        state: SharingCaptureState(
          revisionPrefix: prefix,
          paused: paused,
          pausedUntil: until.map { Int64($0) },
          resumeAfter: after.map { Int64($0) } ?? 0
        )
      )
    }

    Function("isQueueOwner") { (owner: String, deviceId: String) -> Bool in
      TrackingRuntime.locked { TrackingRuntime.queueOwner() == owner && TrackingRuntime.queueDeviceId() == deviceId }
    }

    Function("setQueueOwner") { (owner: String, deviceId: String) in
      try TrackingRuntime.setQueueOwner(owner: owner, deviceId: deviceId)
    }

    Function("provisionEpochKeys") { (keys: [[String: Any]], preserveGroupIds: [String]?) in
      let parsed = try keys.map { key in
        guard let epochKey = (key["epochKeyBase64"] as? String).flatMap({ Data(base64Encoded: $0) }) else {
          throw TrackingInputError(field: "epochKeyBase64")
        }
        return ProvisionedEpochKey(
          groupId: try Self.string(key, "groupId"),
          epochId: try Self.string(key, "epochId"),
          epochKey: epochKey,
          senderDeviceId: try Self.string(key, "senderDeviceId"),
          kind: key["kind"] as? String ?? "trackingPoint"
        )
      }
      try TrackingRuntime.epochKeys.replacePreserving(parsed, groupIds: preserveGroupIds ?? [])
    }

    Function("revokeEpochKeys") { (groupIds: [String]?) in
      let groups = groupIds?.isEmpty == false ? groupIds : nil
      if groups == nil {
        TrackingRuntime.locked { TrackingRuntime.setCaptureEnabled(false) }
      }
      try TrackingRuntime.epochKeys.revoke(groups)
      try TrackingRuntime.places.removeGroups(groups)
      if let groups { try TrackingDatabase.shared().deleteQueuedDrives(groupIds: groups) }
    }

    AsyncFunction("setGroupPlaces") { (owner: String, deviceId: String, groupId: String, places: [[String: Any]]) -> Bool in
      let parsed = try places.filter { ($0["sharesTransitions"] as? Bool) ?? true }.map { place in
        PlaceGeofence(
          groupId: groupId,
          placeId: try Self.string(place, "placeId"),
          latitude: try Self.double(place, "latitude"),
          longitude: try Self.double(place, "longitude"),
          radiusMeters: try Self.double(place, "radiusMeters")
        )
      }
      return try TrackingRuntime.locked {
        guard TrackingRuntime.queueOwner() == owner, TrackingRuntime.queueDeviceId() == deviceId else { return false }
        try TrackingRuntime.places.setGroupPlaces(groupId, places: parsed)
        return true
      }
    }

    Function("listPlaceGroups") { (owner: String, deviceId: String) -> [String]? in
      TrackingRuntime.locked {
        guard TrackingRuntime.queueOwner() == owner, TrackingRuntime.queueDeviceId() == deviceId else { return nil }
        return Array(TrackingRuntime.places.groups())
      }
    }

    AsyncFunction("listPlaceTransitions") { (owner: String) -> [[String: Any]] in
      try TrackingRuntime.places.queued(owner: owner, limit: 200).map {
        [
          "clientId": $0.clientId,
          "senderDeviceId": $0.senderDeviceId,
          "groupId": $0.groupId,
          "placeId": $0.placeId,
          "direction": $0.direction,
          "occurredAt": Double($0.occurredAt),
        ]
      }
    }

    AsyncFunction("deletePlaceTransitions") { (clientIds: [String]) in
      try TrackingRuntime.places.acknowledge(clientIds: clientIds)
    }

    AsyncFunction("listQueuedDrives") { (owner: String) -> [[String: Any]] in
      try TrackingDatabase.shared().listQueuedDrives(owner: owner, limit: 200).map {
        [
          "id": Double($0.id),
          "groupId": $0.groupId,
          "driveId": $0.driveId,
          "epochId": $0.epochId,
          "senderDeviceId": $0.senderDeviceId,
          "startHour": Double($0.startHour),
          "nonce": $0.nonce,
          "ciphertext": $0.ciphertext,
        ]
      }
    }

    AsyncFunction("deleteQueuedDrives") { (ids: [Double]) in
      try TrackingDatabase.shared().deleteQueuedDrives(ids: ids.map { Int64($0) })
    }

    Function("isPlaceSearchAvailable") { () -> Bool in
      false
    }

    AsyncFunction("searchPlaces") { (_: String, _: [String: Double]?) -> [String: String] in
      ["status": "unavailable"]
    }

    Function("showEventNotice") { (kind: String, key: String, title: String, body: String?, groupName: String?, link: String) -> Bool in
      Notices.showEvent(kind: kind, key: key, title: title, body: body, groupName: groupName, link: link)
    }

    AsyncFunction("clearEventNotices") { (keepSecurityAlerts: Bool, promise: Promise) in
      Notices.clearEvents(keepSecurityAlerts: keepSecurityAlerts) { promise.resolve() }
    }

    Function("pendingPushToken") { (_: String) -> String? in
      nil
    }

    Function("confirmPushToken") { (_: String, _: String?, _: Bool) in
    }

    Function("pushStatus") { (_: String) -> [String: Any] in
      ["builtIn": false, "serverPush": NSNull(), "registration": "noToken", "lastWakeAt": NSNull(), "lastWakeKind": NSNull()]
    }

    Function("forgetPushToken") { (_: String?) -> Bool in
      false
    }

    Function("finishUploadTask") { (_: String) in
    }

    Function("listProvisionedEpochKeys") { () -> [[String: Any]] in
      TrackingRuntime.epochKeys.list().map {
        ["groupId": $0.groupId, "epochId": $0.epochId, "senderDeviceId": $0.senderDeviceId, "kind": $0.kind]
      }
    }

    AsyncFunction("startCapture") { (intervalMs: Double?) in
      let (generation, parked) = TrackingRuntime.locked {
        TrackingRuntime.setCaptureEnabled(true)
        return (TrackingRuntime.commands.start(), TrackingRuntime.isCaptureParked())
      }
      if parked {
        TrackingRuntime.scheduleParkedCheck()
        return
      }
      LocationCapture.shared.start(intervalMs: intervalMs.map { Int64($0) }, generation: generation)
    }.runOnQueue(.main)

    AsyncFunction("refreshCapture") {
      LocationCapture.shared.refresh()
    }.runOnQueue(.main)

    AsyncFunction("stopCapture") {
      TrackingRuntime.locked {
        TrackingRuntime.commands.stop()
        TrackingRuntime.isCaptureRunning = false
        TrackingRuntime.setCaptureEnabled(false)
      }
      LocationCapture.shared.stop()
    }.runOnQueue(.main)

    Function("isCaptureRunning") {
      TrackingRuntime.locked { TrackingRuntime.isCaptureRunning } || TrackingRuntime.isCaptureParked()
    }

    Function("isLowPowerMode") {
      TrackingRuntime.isLowPowerMode()
    }

    Function("setLowPowerMode") { (enabled: Bool) in
      TrackingRuntime.setLowPowerMode(enabled)
    }

    Function("isDriveDetectionOn") {
      TrackingRuntime.isDriveDetectionOn()
    }

    Function("setDriveDetection") { (on: Bool) in
      TrackingRuntime.setDriveDetection(on)
    }

    Function("isCrashAlertsOn") {
      TrackingRuntime.isCrashAlertsOn()
    }

    Function("setCrashAlerts") { (on: Bool) in
      TrackingRuntime.setCrashAlerts(on)
    }

    Function("setCrashAlertContext") { (_: [String: String], _: String) in
    }

    Function("startCrashTest") {
    }

    AsyncFunction("listDriveIds") { (_: String) -> [String] in
      []
    }

    AsyncFunction("deleteDrives") { (_: String, _: [String]) in
    }

    Function("areNotificationsEnabled") {
      Notices.areEnabled()
    }

    Function("shouldShowNotificationRationale") {
      false
    }

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      Notices.requestPermission { promise.resolve($0) }
    }

    AsyncFunction("setRecentsPreviewHidden") { (hidden: Bool) in
      PrivacyCover.setHidden(hidden)
    }.runOnQueue(.main)

    Function("elapsedRealtime") {
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000
    }

    Function("showNotice") { (kind: String) -> Bool in
      guard let notice = Notice(rawValue: kind) else { throw TrackingInputError(field: "kind") }
      return Notices.show(notice)
    }

    Function("dismissNotice") { (slot: String) in
      guard let noticeSlot = NoticeSlot(rawValue: slot) else { throw TrackingInputError(field: "slot") }
      Notices.dismiss(noticeSlot)
    }

    AsyncFunction("countUnassignedCiphertexts") { (senderDeviceId: String) -> Double in
      Double(try TrackingDatabase.shared().countUnassignedCiphertexts(senderDeviceId: senderDeviceId))
    }

    AsyncFunction("assignUnassignedCiphertexts") { (senderDeviceId: String, owner: String) in
      try TrackingDatabase.shared().assignUnassignedCiphertexts(senderDeviceId: senderDeviceId, owner: owner)
    }

    AsyncFunction("listPendingCiphertexts") { (owner: String, limit: Double?, afterId: Double?) -> [[String: Any]] in
      try TrackingDatabase.shared()
        .listCiphertexts(status: CiphertextQueueRow.statusPending, limit: max(Int(limit ?? 100), 1), owner: owner, afterId: Int64(afterId ?? 0))
        .map { row in
          [
            "id": Double(row.id),
            "clientPointId": row.clientPointId,
            "captureId": row.captureId,
            "groupId": row.groupId,
            "epochId": row.epochId,
            "senderDeviceId": row.senderDeviceId,
            "kind": row.kind,
            "algorithm": row.algorithm,
            "nonce": row.nonce,
            "ciphertext": row.ciphertext,
            "queuedAt": Double(row.queuedAt),
            "attemptCount": Double(row.attemptCount),
            "lastAttemptAt": row.lastAttemptAt.map { Double($0) as Any } ?? NSNull(),
            "lastError": row.lastError as Any? ?? NSNull(),
            "status": row.status,
            "role": row.role,
            "capturedHour": row.capturedHour.map { Double($0) as Any } ?? NSNull(),
          ]
        }
    }

    AsyncFunction("markCiphertextsInFlight") { (ids: [Double]) -> [Double] in
      try TrackingDatabase.shared()
        .markCiphertextsInFlight(ids: ids.map { Int64($0) }, attemptedAt: TrackingRuntime.nowMillis())
        .map { Double($0) }
    }

    AsyncFunction("getCiphertextEviction") { (owner: String) -> [String: Double]? in
      try TrackingDatabase.shared().ciphertextEviction(owner: owner).map {
        [
          "pointCount": Double($0.pointCount),
          "oldestQueuedAt": Double($0.oldestQueuedAt),
          "newestQueuedAt": Double($0.newestQueuedAt),
          "revision": Double($0.revision),
        ]
      }
    }

    AsyncFunction("acknowledgeCiphertextEviction") { (owner: String, revision: Double) in
      try TrackingDatabase.shared().acknowledgeCiphertextEviction(owner: owner, revision: Int64(revision))
    }

    AsyncFunction("deleteCiphertexts") { (ids: [Double]) in
      try TrackingDatabase.shared().deleteCiphertexts(ids: ids.map { Int64($0) })
    }

    AsyncFunction("deleteCiphertextsByOwner") { (owner: String) in
      CapturePipeline.clearAllowances(owner: owner)
      try TrackingDatabase.shared().deleteCiphertexts(owner: owner)
    }

    AsyncFunction("deleteCiphertextsByGroup") { (owner: String, groupId: String) in
      try TrackingDatabase.shared().deleteCiphertexts(owner: owner, groupId: groupId)
    }

    AsyncFunction("requeueCiphertexts") { (ids: [Double], error: String?) in
      try TrackingDatabase.shared().requeueCiphertexts(ids: ids.map { Int64($0) }, attemptedAt: TrackingRuntime.nowMillis(), error: error)
    }
  }

  private static func string(_ map: [String: Any], _ key: String) throws -> String {
    guard let value = map[key] as? String else { throw TrackingInputError(field: key) }
    return value
  }

  private static func double(_ map: [String: Any], _ key: String) throws -> Double {
    guard let value = (map[key] as? NSNumber)?.doubleValue, value.isFinite else { throw TrackingInputError(field: key) }
    return value
  }
}

struct TrackingInputError: Error, CustomStringConvertible {
  let field: String

  var description: String {
    "\(field) is required."
  }
}

enum PrivacyCover {
  private static var hidden = false
  private static var cover: UIView?
  private static var observers: [NSObjectProtocol] = []

  static func setHidden(_ value: Bool) {
    hidden = value
    if !observers.isEmpty { return }
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in show() },
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in remove() },
    ]
  }

  private static func show() {
    guard hidden, cover == nil else { return }
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
    guard let window else { return }
    let view = UIView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = .systemBackground
    window.addSubview(view)
    cover = view
  }

  private static func remove() {
    cover?.removeFromSuperview()
    cover = nil
  }
}
