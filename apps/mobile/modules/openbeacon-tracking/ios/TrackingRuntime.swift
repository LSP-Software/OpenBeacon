import BackgroundTasks
import CoreLocation
import Foundation

final class PlaceDetection {
  static let maxFutureFixMillis: Int64 = 5 * 60_000

  private let store = PlaceStore()
  private let detector = PlaceDwellDetector()
  private let lock = NSRecursiveLock()
  private var places: [PlaceGeofence]?

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  func onFix(
    owner: String,
    deviceId: String,
    sharing: SharingCaptureState,
    nowMillis: Int64,
    latitude: Double,
    longitude: Double,
    accuracyMeters: Double?,
    timestampMillis: Int64,
    speedMetersPerSecond: Double?
  ) throws {
    try locked {
      if !sharing.canCapture(timestamp: timestampMillis, now: nowMillis) {
        detector.reset()
        return
      }
      if timestampMillis > nowMillis + Self.maxFutureFixMillis { return }
      let current = places ?? store.list()
      places = current
      let rows = detector.onFix(places: current, latitude: latitude, longitude: longitude, accuracyMeters: accuracyMeters, timestampMillis: timestampMillis, speedMetersPerSecond: speedMetersPerSecond).map {
        PlaceTransitionRow(
          clientId: UUID().uuidString.lowercased(),
          owner: owner,
          senderDeviceId: deviceId,
          groupId: $0.place.groupId,
          placeId: $0.place.placeId,
          direction: $0.arrived ? "ARRIVE" : "LEAVE",
          occurredAt: $0.occurredAt
        )
      }
      try TrackingDatabase.shared().insertPlaceTransitions(rows)
    }
  }

  func setGroupPlaces(_ groupId: String, places groupPlaces: [PlaceGeofence]) throws {
    try locked {
      try store.replaceGroup(groupId, places: groupPlaces)
      places = nil
      try TrackingDatabase.shared().deletePlaceTransitions(groupId: groupId, except: groupPlaces.map(\.placeId))
    }
  }

  func removeGroups(_ groupIds: [String]?) throws {
    try locked {
      try store.removeGroups(groupIds)
      places = nil
      if let groupIds {
        try TrackingDatabase.shared().deletePlaceTransitions(groupIds: groupIds)
      } else {
        try TrackingDatabase.shared().deletePlaceTransitions(owner: nil)
      }
    }
  }

  func onSharingChanged(owner: String, sharing: SharingCaptureState, nowMillis: Int64) throws {
    try locked {
      detector.reset()
      if sharing.isPaused(now: nowMillis) { try TrackingDatabase.shared().deletePlaceTransitions(owner: owner) }
    }
  }

  func isConfirming(nowMillis: Int64) -> Bool {
    locked { detector.isConfirming(nowMillis: nowMillis) }
  }

  func groups() -> Set<String> {
    locked { store.groups() }
  }

  func restart() {
    locked { detector.reset() }
  }

  func hasQueued(owner: String) throws -> Bool {
    try locked { try TrackingDatabase.shared().hasPlaceTransitions(owner: owner) }
  }

  func queued(owner: String, limit: Int) throws -> [PlaceTransitionRow] {
    try locked { try TrackingDatabase.shared().listPlaceTransitions(owner: owner, limit: limit) }
  }

  func acknowledge(clientIds: [String]) throws {
    try locked { try TrackingDatabase.shared().deletePlaceTransitions(clientIds: clientIds) }
  }
}

enum TrackingRuntime {
  static let lock = NSRecursiveLock()
  static let commands = CaptureCommandState()
  static let epochKeys = EpochKeyStore()
  static let places = PlaceDetection()
  static var isCaptureRunning = false

  private static let defaults = UserDefaults.standard
  private static var syncListener: ((String) -> Void)?
  private static var pendingSyncReason: String?

  static func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  static func isLowPowerMode() -> Bool {
    defaults.bool(forKey: "openbeacon_tracking_low_power_mode")
  }

  static func setLowPowerMode(_ enabled: Bool) {
    defaults.set(enabled, forKey: "openbeacon_tracking_low_power_mode")
  }

  static func nowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
  }

  static func setSyncListener(_ listener: ((String) -> Void)?) {
    let pending: String? = locked {
      syncListener = listener
      defer { pendingSyncReason = nil }
      return listener == nil ? nil : pendingSyncReason
    }
    if let pending { listener?(pending) }
  }

  static func requestSync(_ reason: String) {
    let listener: ((String) -> Void)? = locked {
      if syncListener == nil { pendingSyncReason = reason }
      return syncListener
    }
    listener?(reason)
  }

  static func queueOwner() -> String? {
    defaults.string(forKey: "openbeacon_tracking_queue.owner")
  }

  static func queueDeviceId() -> String? {
    defaults.string(forKey: "openbeacon_tracking_queue.deviceId")
  }

  private static func ownerScope() -> String? {
    guard
      let owner = queueOwner(),
      let deviceId = queueDeviceId(),
      let data = try? JSONSerialization.data(withJSONObject: [owner, deviceId])
    else { return nil }
    return String(decoding: data, as: UTF8.self)
  }

  private static func sharingScope() -> String? {
    ownerScope().map { "openbeacon_tracking_sharing." + $0 }
  }

  private static func historyShareKey() -> String? {
    ownerScope().map { "openbeacon_tracking_history_share." + $0 }
  }

  static func sharingState() -> SharingCaptureState {
    guard let scope = sharingScope() else { return SharingCaptureState(paused: true) }
    let until = (defaults.object(forKey: "\(scope).until") as? NSNumber)?.int64Value ?? 0
    return SharingCaptureState(
      revisionPrefix: defaults.string(forKey: "\(scope).prefix") ?? "",
      paused: defaults.object(forKey: "\(scope).paused") as? Bool ?? true,
      pausedUntil: until > 0 ? until : nil,
      resumeAfter: (defaults.object(forKey: "\(scope).after") as? NSNumber)?.int64Value ?? 0
    )
  }

  private static func setSharingState(_ state: SharingCaptureState) {
    guard let scope = sharingScope() else { return }
    let previous = SharingCaptureState.confirmedRevision(stored: defaults.string(forKey: "\(scope).confirmed"), current: sharingState())
    defaults.set(state.revisionPrefix, forKey: "\(scope).prefix")
    defaults.set(state.paused, forKey: "\(scope).paused")
    defaults.set(NSNumber(value: state.pausedUntil ?? 0), forKey: "\(scope).until")
    defaults.set(NSNumber(value: state.resumeAfter), forKey: "\(scope).after")
    defaults.set(state.confirmedRevision(replacing: previous), forKey: "\(scope).confirmed")
  }

  static func historyShare() -> CaptureHistoryShare {
    guard
      let key = historyShareKey(),
      let stored = defaults.dictionary(forKey: key),
      let account = stored["account"] as? String,
      let groups = stored["groups"] as? [String: String]
    else { return CaptureHistoryShare() }
    return CaptureHistoryShare(account: account, groups: groups)
  }

  static func setHistoryShare(owner: String, deviceId: String, account: String, groups: [String: String]) -> Bool {
    locked {
      guard queueOwner() == owner, queueDeviceId() == deviceId, let key = historyShareKey() else { return false }
      defaults.set(["account": account, "groups": groups] as [String: Any], forKey: key)
      return true
    }
  }

  private static func confirmedRevision() -> String {
    SharingCaptureState.confirmedRevision(stored: sharingScope().flatMap { defaults.string(forKey: "\($0).confirmed") }, current: sharingState())
  }

  static func applySharingState(owner: String, deviceId: String, state: SharingCaptureState) -> Bool {
    let changed: Bool? = locked {
      if queueOwner() != owner || queueDeviceId() != deviceId { return nil }
      let current = sharingState()
      if !state.canReplace(current, confirmedRevision: confirmedRevision()) { return nil }
      if current == state { return false }
      commands.stop()
      setSharingState(state)
      do {
        try places.onSharingChanged(owner: owner, sharing: state, nowMillis: nowMillis())
      } catch {
        NSLog("OpenBeaconTracking: failed to clear place transitions after a sharing change: \(error)")
      }
      return true
    }
    guard let changed else { return false }
    if changed && locked({ isCaptureRunning }) {
      DispatchQueue.main.async { LocationCapture.shared.updateSharing() }
    }
    return true
  }

  static func setQueueOwner(owner: String, deviceId: String) throws {
    try locked {
      let previousOwner = queueOwner()
      let previousDeviceId = queueDeviceId()
      if previousOwner != owner || (previousDeviceId != nil && previousDeviceId != deviceId) {
        commands.stop()
        isCaptureRunning = false
        setCaptureEnabled(false)
        DispatchQueue.main.async { LocationCapture.shared.stop() }
        try epochKeys.revoke(nil)
        try places.removeGroups(nil)
        try TrackingDatabase.shared().deleteQueuedDrives(owner: nil)
      }
      if let previousOwner, previousOwner != owner { CapturePipeline.clearAllowances(owner: previousOwner) }
      defaults.set(owner, forKey: "openbeacon_tracking_queue.owner")
      defaults.set(deviceId, forKey: "openbeacon_tracking_queue.deviceId")
    }
  }

  static func isCaptureEnabled() -> Bool {
    defaults.bool(forKey: "openbeacon_tracking_capture.enabled")
  }

  static func setCaptureEnabled(_ enabled: Bool) {
    defaults.set(enabled, forKey: "openbeacon_tracking_capture.enabled")
    if !enabled {
      cancelParkedCheck()
      Notices.dismiss(.locationPermission)
      Notices.dismiss(.sharingChanged)
    }
  }

  static func isCaptureParked() -> Bool {
    isCaptureEnabled() && sharingState().isConfirmedIndefinitePause
  }

  static func hasLocationPermission() -> Bool {
    let status = LocationCapture.authorizationStatus()
    return status == .authorizedAlways || status == .authorizedWhenInUse
  }

  static func hasBackgroundLocationPermission() -> Bool {
    LocationCapture.authorizationStatus() == .authorizedAlways
  }

  static func shouldRestoreCapture() -> Bool {
    isCaptureEnabled() && queueOwner() != nil && !epochKeys.list().isEmpty && hasLocationPermission() && hasBackgroundLocationPermission()
  }

  static func hasLostLocationPermission() -> Bool {
    isCaptureEnabled() && queueOwner() != nil && !epochKeys.list().isEmpty && !(hasLocationPermission() && hasBackgroundLocationPermission())
  }

  static func restoreOnLaunch() {
    if !isCaptureEnabled() { return }
    if isCaptureParked() {
      scheduleParkedCheck()
    } else if shouldRestoreCapture() {
      LocationCapture.shared.start(intervalMs: nil, generation: nil)
    } else if hasLostLocationPermission() {
      _ = Notices.show(.locationPermission)
    }
  }

  static func restoreCapture() {
    let restoring: Bool? = locked {
      if isCaptureParked() { return nil }
      return !(isCaptureRunning || !isCaptureEnabled())
    }
    guard let restoring else {
      scheduleParkedCheck()
      return
    }
    if restoring {
      if shouldRestoreCapture() {
        LocationCapture.shared.start(intervalMs: nil, generation: nil, resumingSharing: true)
        if locked({ isCaptureRunning }) { return }
      }
      showResumeNotice()
    }
    cancelParkedCheck()
  }

  static func showResumeNotice() {
    _ = Notices.show(
      hasLostLocationPermission()
        ? .locationPermission
        : sharingState().isPaused(now: nowMillis()) ? .sharingChanged : .sharingResumed
    )
  }

  private static let parkedCheckIdentifier = (Bundle.main.bundleIdentifier ?? "net.openbeacon.app") + ".sharing-check"

  private static var canScheduleParkedCheck: Bool {
    (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])?.contains(parkedCheckIdentifier) == true
  }

  static func registerParkedCheck() {
    guard canScheduleParkedCheck else { return }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: parkedCheckIdentifier, using: .main) { task in
      var completed = false
      let complete = { (success: Bool) in
        if completed { return }
        completed = true
        task.setTaskCompleted(success: success)
      }
      task.expirationHandler = { complete(false) }
      scheduleParkedCheck()
      guard isCaptureParked() else {
        restoreCapture()
        complete(true)
        return
      }
      requestSync("parked")
      DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
        restoreCapture()
        complete(true)
      }
    }
  }

  static func scheduleParkedCheck() {
    guard canScheduleParkedCheck else { return }
    let request = BGAppRefreshTaskRequest(identifier: parkedCheckIdentifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("OpenBeaconTracking: failed to schedule the location sharing check: \(error)")
    }
  }

  static func cancelParkedCheck() {
    guard canScheduleParkedCheck else { return }
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: parkedCheckIdentifier)
  }
}
