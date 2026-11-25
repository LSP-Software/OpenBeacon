package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.capture.CaptureHistoryShare
import expo.modules.openbeacontracking.crypto.DriveRecord
import expo.modules.openbeacontracking.crypto.DriveRecordCodec
import expo.modules.openbeacontracking.crypto.DrivingEventType
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey

class DriveRecorder(
  private val log: DriveLog,
  private val records: DriveRecordStore,
  private val queue: DriveQueue,
  private val epochKeys: () -> List<ProvisionedEpochKey>,
  private val epochKeysAt: (Long) -> List<ProvisionedEpochKey>,
  private val historyShare: () -> CaptureHistoryShare,
  private val utcOffsetMinutes: (Long) -> Int,
  private val newDriveId: () -> String = { DriveRecordCodec.newDriveId() },
  private val findSpeeding: (List<DriveFix>) -> SpeedingResult = { SpeedingResult(checked = false, events = emptyList()) },
  private val tellGroup: (String) -> Boolean = { true },
  private val onFinished: (DriveRecord, List<String>) -> Unit = { _, _ -> },
) {
  private var detector = DriveDetector()
  private var owner: String? = null
  private var startKeys = emptyList<ProvisionedEpochKey>()
  private val events = DrivingEventFinder()

  val recording: Boolean
    @Synchronized get() = detector.recording

  val wantsFastFixes: Boolean
    @Synchronized get() = detector.wantsFastFixes

  val wantsSensors: Boolean
    @Synchronized get() = detector.watching

  @Synchronized
  fun onAccelerometer(samples: List<AccelerometerSample>) {
    events.onAccelerometer(samples)
  }

  @Synchronized
  fun onPhoneUse(change: PhoneUseChange) {
    events.onPhoneUse(change)
  }

  @Synchronized
  fun onFixes(owner: String, fixes: List<DriveFix>): List<DriveRecord> {
    restore(owner)
    val finished = mutableListOf<DriveRecord>()
    for (fix in fixes) {
      val step = detector.onFix(fix)
      step.finished?.let { drive -> finish(owner, drive)?.let { finished += it } }
      if (step.started) startKeys = detector.retainedFixes.firstOrNull()?.let { epochKeysAt(it.timeMillis) } ?: emptyList()
    }
    (detector.retainedFixes.firstOrNull() ?: fixes.lastOrNull())?.let { events.trimBefore(it.timeMillis) }
    persist(owner)
    return finished
  }

  @Synchronized
  fun onPlaceArrive(owner: String): DriveRecord? {
    restore(owner)
    val drive = detector.onPlaceArrive()?.let { finish(owner, it) }
    persist(owner)
    return drive
  }

  @Synchronized
  fun interrupt(owner: String): DriveRecord? {
    restore(owner)
    val drive = detector.interrupt()?.let { finish(owner, it) }
    log.clear()
    return drive
  }

  @Synchronized
  fun tick(owner: String, nowMillis: Long): DriveRecord? {
    restore(owner)
    val last = detector.retainedFixes.lastOrNull() ?: return null
    if (!detector.recording || nowMillis - last.timeMillis < DriveDetector.END_AFTER_MILLIS) return null
    return interrupt(owner)
  }

  @Synchronized
  fun discard() {
    detector = DriveDetector()
    startKeys = emptyList()
    log.clear()
  }

  @Synchronized
  fun driveIds(owner: String): List<String> = records.list(owner).map { it.driveId }

  @Synchronized
  fun record(owner: String, driveId: String): DriveRecord? = records.list(owner).find { it.driveId == driveId }

  @Synchronized
  fun deleteDrives(owner: String, driveIds: List<String>) {
    records.delete(owner, driveIds.toSet())
    queue.deleteByDrives(owner, driveIds)
  }

  @Synchronized
  fun clearRecords() {
    records.clear(null)
  }

  private fun restore(owner: String) {
    if (this.owner == owner) return
    detector = DriveDetector()
    startKeys = emptyList()
    this.owner = owner
    val entry = log.read() ?: return
    if (entry.owner != owner) {
      log.clear()
      return
    }
    entry.fixes.forEach { detector.onFix(it) }
    startKeys = entry.fixes.firstOrNull()?.let { start -> epochKeysAt(start.timeMillis).filter { entry.startEpochs[it.groupId] == it.epochId } } ?: emptyList()
  }

  private fun persist(owner: String) {
    if (detector.recording) {
      log.save(DriveLogEntry(owner, startKeys.associate { it.groupId to it.epochId }, detector.retainedFixes))
    } else {
      log.clear()
    }
  }

  private fun finish(owner: String, drive: DetectedDrive): DriveRecord? {
    val keys = startKeys
    startKeys = emptyList()
    val speeding = findSpeeding(drive.fixes)
    val found = events.find(drive.fixes)
    val built =
      DriveRecord(
        driveId = newDriveId(),
        start = drive.start,
        end = drive.end,
        distanceMeters = drive.distanceMeters,
        checkedDistanceMeters = drive.checkedDistanceMeters,
        durationSeconds = drive.durationSeconds,
        topSpeed = drive.topSpeed,
        averageSpeed = drive.averageSpeed,
        utcOffsetMinutes = utcOffsetMinutes(drive.start.timeMillis),
        counts = found.counts + (DrivingEventType.SPEEDING to speeding.events.size),
        passenger = false,
        speedLimitsChecked = speeding.checked,
        tellGroup = true,
        events = DrivingEventFinder.mostSevereFirst(found.events + speeding.events),
      )
    val record = DriveRecordCodec.encode(built)?.let { DriveRecordCodec.decode(it) } ?: return null
    val groupIds =
      DriveUploads.enqueue(
        owner = owner,
        record = record,
        startKeys = keys,
        currentGroupIds = epochKeys().map { it.groupId }.toSet(),
        historyShare = historyShare(),
        queue = queue,
        tellGroup = tellGroup,
      )
    records.save(owner, record)
    onFinished(record, groupIds)
    return record
  }
}
