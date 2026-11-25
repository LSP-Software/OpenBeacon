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
  private val historyShare: () -> CaptureHistoryShare,
  private val utcOffsetMinutes: (Long) -> Int,
  private val newDriveId: () -> String = { DriveRecordCodec.newDriveId() },
) {
  private var detector = DriveDetector()
  private var owner: String? = null
  private var startKeys = emptyList<ProvisionedEpochKey>()

  val recording: Boolean
    @Synchronized get() = detector.recording

  val wantsFastFixes: Boolean
    @Synchronized get() = detector.wantsFastFixes

  @Synchronized
  fun onFixes(owner: String, fixes: List<DriveFix>): List<DriveRecord> {
    restore(owner)
    val finished = mutableListOf<DriveRecord>()
    for (fix in fixes) {
      val step = detector.onFix(fix)
      step.finished?.let { drive -> finish(owner, drive)?.let { finished += it } }
      if (step.started) startKeys = epochKeys()
    }
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
  fun deleteDrives(owner: String, driveIds: List<String>) {
    records.delete(owner, driveIds.toSet())
    queue.deleteByDrives(owner, driveIds)
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
    startKeys = epochKeys().filter { entry.startEpochs[it.groupId] == it.epochId }
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
        counts = DrivingEventType.entries.associateWith { 0 },
        passenger = false,
        speedLimitsChecked = false,
        tellGroup = true,
        events = emptyList(),
      )
    val record = DriveRecordCodec.encode(built)?.let { DriveRecordCodec.decode(it) } ?: return null
    DriveUploads.enqueue(
      owner = owner,
      record = record,
      startKeys = keys,
      currentGroupIds = epochKeys().map { it.groupId }.toSet(),
      historyShare = historyShare(),
      queue = queue,
    )
    records.save(owner, record)
    return record
  }
}
