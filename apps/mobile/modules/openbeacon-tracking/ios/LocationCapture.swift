import CoreLocation
import Network
import UIKit

final class LocationCapture: NSObject, CLLocationManagerDelegate {
  static let shared = LocationCapture()
  static let minIntervalMs: Int64 = 5_000
  private static let sharingCheckIntervalMs: Int64 = 300_000

  private let manager = CLLocationManager()
  private let captureQueue = DispatchQueue(label: "net.openbeacon.tracking.capture")
  private let pathMonitor = NWPathMonitor()

  private var capturing = false
  private var backgroundSession: AnyObject?
  private var sharingCheckTimer: Timer?
  private var lastSharingCheckMs: Int64 = 0
  private var lastProcessedFixMs: Int64?
  private var minimumFixMs: Int64 = 0

  private var online = false
  private var currentIntervalMs = CaptureSamplingPolicy.defaultIntervalMs
  private var currentUploadIntervalMs = CaptureSamplingPolicy.uploadIntervalMs
  private var lastUploadRequestMs: Int64 = 0
  private var lastQueued: (latitude: Double, longitude: Double, atMs: Int64)?
  private var refreshState = CaptureRefreshState()
  private let pipeline = CapturePipeline()

  override private init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    manager.pausesLocationUpdatesAutomatically = false
    manager.activityType = .other
    UIDevice.current.isBatteryMonitoringEnabled = true
    pathMonitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let nowOnline = path.status == .satisfied
      TrackingRuntime.locked { self.online = nowOnline }
      if nowOnline { self.requestUploadIfDue(generation: TrackingRuntime.commands.current()) }
    }
    pathMonitor.start(queue: captureQueue)
  }

  static func authorizationStatus() -> CLAuthorizationStatus {
    shared.manager.authorizationStatus
  }

  func start(intervalMs: Int64?, generation: Int64?, resumingSharing: Bool = false) {
    let allowed: Bool = TrackingRuntime.locked {
      if let generation {
        return TrackingRuntime.commands.isCurrent(generation) || TrackingRuntime.isCaptureEnabled()
      }
      return TrackingRuntime.shouldRestoreCapture()
    }
    guard allowed else {
      if generation == nil { stopAfterFailedStart() }
      return
    }
    if TrackingRuntime.isCaptureParked() {
      stop()
      TrackingRuntime.scheduleParkedCheck()
      return
    }
    guard TrackingRuntime.hasLocationPermission() else {
      stop()
      if resumingSharing { TrackingRuntime.showResumeNotice() } else { stopAfterFailedStart() }
      return
    }

    let policyIntervalMs = CaptureSamplingPolicy.evaluate(
      battery: readBattery(),
      speedMetersPerSecond: nil,
      distanceFromLastQueuedMeters: nil,
      timeSinceLastQueuedMs: nil
    ).intervalMs
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    TrackingRuntime.locked {
      TrackingRuntime.isCaptureRunning = true
      currentIntervalMs = max(intervalMs ?? policyIntervalMs, Self.minIntervalMs)
    }
    TrackingRuntime.cancelParkedCheck()
    Notices.dismiss(.locationPermission)
    Notices.dismiss(.sharingChanged)
    updateSharing()
  }

  func refresh() {
    let running = TrackingRuntime.locked { TrackingRuntime.isCaptureRunning }
    guard running, capturing else { return }
    TrackingRuntime.locked { refreshState.request() }
    lastProcessedFixMs = nil
  }

  func stop() {
    manager.stopUpdatingLocation()
    manager.stopMonitoringSignificantLocationChanges()
    endBackgroundSession()
    sharingCheckTimer?.invalidate()
    sharingCheckTimer = nil
    capturing = false
    lastProcessedFixMs = nil
    TrackingRuntime.locked {
      TrackingRuntime.isCaptureRunning = false
      lastQueued = nil
      refreshState.clear()
    }
  }

  func updateSharing() {
    guard TrackingRuntime.locked({ TrackingRuntime.isCaptureRunning }) else { return }
    TrackingRuntime.places.restart()
    sharingCheckTimer?.invalidate()
    sharingCheckTimer = nil
    let sharing = TrackingRuntime.locked { TrackingRuntime.sharingState() }
    if sharing.isConfirmedIndefinitePause {
      stop()
      TrackingRuntime.scheduleParkedCheck()
      return
    }
    let now = TrackingRuntime.nowMillis()
    if sharing.isPaused(now: now) {
      manager.stopUpdatingLocation()
      endBackgroundSession()
      capturing = false
      manager.startMonitoringSignificantLocationChanges()
      let nextCheck = min(sharing.pausedUntil ?? .max, now + Self.sharingCheckIntervalMs)
      sharingCheckTimer = Timer.scheduledTimer(withTimeInterval: max(Double(nextCheck - now) / 1000, 1), repeats: false) { [weak self] _ in
        self?.checkSharing()
      }
      return
    }
    TrackingRuntime.locked {
      lastQueued = nil
      lastUploadRequestMs = 0
      refreshState.request()
    }
    minimumFixMs = now
    lastProcessedFixMs = nil
    beginBackgroundSession()
    manager.startUpdatingLocation()
    manager.startMonitoringSignificantLocationChanges()
    capturing = true
  }

  private func checkSharing() {
    lastSharingCheckMs = TrackingRuntime.nowMillis()
    TrackingRuntime.requestSync("sharing")
    updateSharing()
  }

  private func stopAfterFailedStart() {
    if TrackingRuntime.hasLostLocationPermission() { _ = Notices.show(.locationPermission) }
  }

  private func beginBackgroundSession() {
    if #available(iOS 17.0, *), backgroundSession == nil {
      backgroundSession = CLBackgroundActivitySession()
    }
  }

  private func endBackgroundSession() {
    if #available(iOS 17.0, *) {
      (backgroundSession as? CLBackgroundActivitySession)?.invalidate()
    }
    backgroundSession = nil
  }

  private func readBattery() -> BatterySnapshot {
    let device = UIDevice.current
    let level = device.batteryLevel
    let known = level >= 0
    return BatterySnapshot(
      level: known ? min(max(Int((level * 100).rounded()), 0), 100) : 0,
      charging: device.batteryState == .charging || device.batteryState == .full,
      powerSaveMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
      levelKnown: known
    )
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard TrackingRuntime.locked({ TrackingRuntime.isCaptureRunning }), !TrackingRuntime.hasLocationPermission() else { return }
    TrackingRuntime.commands.stop()
    stop()
    stopAfterFailedStart()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("OpenBeaconTracking: location update failed: \(error)")
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last, TrackingRuntime.locked({ TrackingRuntime.isCaptureRunning }) else { return }
    let now = TrackingRuntime.nowMillis()
    let sharing = TrackingRuntime.locked { TrackingRuntime.sharingState() }
    if sharing.isPaused(now: now) {
      if now - lastSharingCheckMs >= Self.sharingCheckIntervalMs { checkSharing() }
      return
    }
    if !capturing {
      updateSharing()
      return
    }
    let fixMs = Int64(location.timestamp.timeIntervalSince1970 * 1000)
    guard fixMs > minimumFixMs else { return }
    let (intervalMs, refreshPending) = TrackingRuntime.locked { (currentIntervalMs, refreshState.pending != nil) }
    if !refreshPending, let lastProcessedFixMs, fixMs - lastProcessedFixMs < intervalMs { return }
    lastProcessedFixMs = fixMs
    let battery = readBattery()
    let generation = TrackingRuntime.commands.current()
    captureQueue.async { [weak self] in
      guard let self else { return }
      self.enqueueEncryptedFix(location, fixMs: fixMs, battery: battery, generation: generation)
      if TrackingRuntime.locked({ self.online }) { self.requestUploadIfDue(generation: generation) }
    }
  }

  private func isCurrent(_ generation: Int64) -> Bool {
    TrackingRuntime.isCaptureRunning && TrackingRuntime.commands.isCurrent(generation)
  }

  private func enqueueEncryptedFix(_ location: CLLocation, fixMs: Int64, battery: BatterySnapshot, generation: Int64) {
    let speed: Double? = location.speed >= 0 ? location.speed : nil
    let now = TrackingRuntime.nowMillis()
    let (queued, current) = TrackingRuntime.locked { (lastQueued, isCurrent(generation)) }
    guard current else { return }

    detectPlaces(location, fixMs: fixMs, now: now, generation: generation)

    let refreshGeneration = TrackingRuntime.locked { refreshState.pending }
    let decision = CaptureSamplingPolicy.evaluate(
      battery: battery,
      speedMetersPerSecond: speed,
      distanceFromLastQueuedMeters: queued.map {
        PlaceDwellDetector.distanceMeters($0.latitude, $0.longitude, location.coordinate.latitude, location.coordinate.longitude)
      },
      timeSinceLastQueuedMs: queued.map { now - $0.atMs },
      forcedRefresh: refreshGeneration != nil
    )
    TrackingRuntime.locked {
      currentIntervalMs = max(decision.intervalMs, Self.minIntervalMs)
      currentUploadIntervalMs = decision.uploadIntervalMs
    }
    let fix = HistoryFix(
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude,
      timestampMillis: fixMs,
      accuracyMeters: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
      speedMetersPerSecond: speed,
      batteryLevel: battery.levelKnown ? battery.level : nil,
      batteryCharging: battery.charging
    )
    do {
      let result = try pipeline.onFix(fix, live: decision.shouldQueue) { isCurrent(generation) }
      TrackingRuntime.locked {
        guard isCurrent(generation), result.currentFixQueued else { return }
        if (decision.forceUpload || now - lastUploadRequestMs >= decision.uploadIntervalMs) && online {
          TrackingRuntime.requestSync("upload")
          lastUploadRequestMs = now
        }
        if let refreshGeneration { refreshState.complete(refreshGeneration) }
        lastQueued = (location.coordinate.latitude, location.coordinate.longitude, now)
      }
    } catch {
      NSLog("OpenBeaconTracking: failed to encrypt and queue a location fix: \(error)")
    }
  }

  private func detectPlaces(_ location: CLLocation, fixMs: Int64, now: Int64, generation: Int64) {
    do {
      try TrackingRuntime.locked {
        guard
          TrackingRuntime.commands.isCurrent(generation),
          let owner = TrackingRuntime.queueOwner(),
          let deviceId = TrackingRuntime.queueDeviceId()
        else { return }
        try TrackingRuntime.places.onFix(
          owner: owner,
          deviceId: deviceId,
          sharing: TrackingRuntime.sharingState(),
          nowMillis: now,
          latitude: location.coordinate.latitude,
          longitude: location.coordinate.longitude,
          accuracyMeters: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
          timestampMillis: fixMs
        )
      }
    } catch {
      NSLog("OpenBeaconTracking: failed to check places: \(error)")
    }
  }

  private func requestUploadIfDue(generation: Int64) {
    let now = TrackingRuntime.nowMillis()
    let due = TrackingRuntime.locked { now - lastUploadRequestMs >= currentUploadIntervalMs }
    guard due, !TrackingRuntime.locked({ TrackingRuntime.sharingState() }).isPaused(now: now), hasPendingUploads() else { return }
    TrackingRuntime.locked {
      guard isCurrent(generation), now - lastUploadRequestMs >= currentUploadIntervalMs else { return }
      TrackingRuntime.requestSync("upload")
      lastUploadRequestMs = now
    }
  }

  private func hasPendingUploads() -> Bool {
    do {
      let owner = TrackingRuntime.queueOwner()
      if try !TrackingDatabase.shared().listCiphertexts(status: CiphertextQueueRow.statusPending, limit: 1, owner: owner, afterId: 0, exceptRole: CiphertextQueueRow.roleStay).isEmpty {
        return true
      }
      guard let owner else { return false }
      return try TrackingRuntime.places.hasQueued(owner: owner)
    } catch {
      NSLog("OpenBeaconTracking: failed to check for pending uploads: \(error)")
      return false
    }
  }
}
