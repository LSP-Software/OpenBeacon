package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.capture.CaptureHistoryShare
import expo.modules.openbeacontracking.crypto.DriveRecord
import expo.modules.openbeacontracking.crypto.DriveRecordCodec
import expo.modules.openbeacontracking.crypto.DrivingEventType
import expo.modules.openbeacontracking.crypto.SpeedLimitSource
import expo.modules.openbeacontracking.crypto.SealedDriveRecord
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DriveRecorderTest {
  private val startTime = 1_795_594_440_000L
  private var time = startTime
  private var longitude = -0.1
  private var keys = listOf(key("family", "family-epoch-1"), key("work", "work-epoch-1"))
  private val queue = InMemoryDriveQueue()
  private val log = InMemoryDriveLog()
  private val records = InMemoryDriveRecordStore()
  private var share = CaptureHistoryShare()

  private fun key(
    groupId: String,
    epochId: String,
  ) = ProvisionedEpochKey(groupId, epochId, ByteArray(32) { epochId.length.toByte() }, "device-1", "trackingPoint")

  private fun recorder(roads: SpeedLimitRoads? = null) =
    DriveRecorder(
      log = log,
      records = records,
      queue = queue,
      epochKeys = { keys },
      historyShare = { share },
      utcOffsetMinutes = { 60 },
      findSpeeding = { fixes -> SpeedingFinder.find(fixes, roads) },
    )

  private fun fixes(
    speed: Double,
    count: Int,
  ) = (1..count).map {
    time += 1_000
    longitude += speed / (111_320.0 * cos(Math.toRadians(51.5)))
    DriveFix(time, 51.5, longitude, speed, 5.0, batterySaver = false)
  }

  private fun open(row: DriveQueueRow, epochId: String): DriveRecord? =
    DriveRecordCodec.open(
      SealedDriveRecord(row.driveId, row.startHour, row.nonce, row.ciphertext),
      ByteArray(32) { epochId.length.toByte() },
      row.groupId,
      epochId,
      row.senderDeviceId,
    )

  @Test
  fun aFinishedDriveIsQueuedForEachGroupUnderTheEpochCurrentWhenItStarted() {
    val recorder = recorder()
    recorder.onFixes("owner", fixes(15.0, 100))
    keys = listOf(key("family", "family-epoch-22"), key("work", "work-epoch-1"))
    recorder.onFixes("owner", fixes(15.0, 100))
    val finished = recorder.onFixes("owner", fixes(0.0, 300))

    val record = finished.single()
    val rows = queue.list("owner", 10)
    assertEquals(setOf("family" to "family-epoch-1", "work" to "work-epoch-1"), rows.map { it.groupId to it.epochId }.toSet())
    rows.forEach { row -> assertEquals(record.copy(tellGroup = true), open(row, row.epochId)) }
    assertFailsWith<Exception> { open(rows.first { it.groupId == "family" }, "family-epoch-22") }
    assertEquals(startTime + 1_000, record.start.timeMillis)
    assertEquals(60, record.utcOffsetMinutes)
    assertTrue(record.counts.values.all { it == 0 } && record.events.isEmpty() && !record.speedLimitsChecked && !record.passenger)
    assertEquals(listOf(record), records.list("owner"))
    assertNull(log.read())
  }

  @Test
  fun speedingOnAPostedRoadIsCountedBeforeTheDriveIsQueued() {
    val road =
      PackRoadPiece(
        roadId = 1,
        roadClass = 3,
        oneway = false,
        forward = RoadLimit(RoadLimitSource.Posted, 483),
        backward = RoadLimit(RoadLimitSource.Posted, 483),
        lonE5 = intArrayOf(-10_100, 0),
        latE5 = intArrayOf(5_150_000, 5_150_000),
      )
    val recorder = recorder(SpeedLimitRoads { _, _, _ -> listOf(road) })
    recorder.onFixes("owner", fixes(13.0, 60) + fixes(20.0, 40) + fixes(13.0, 60))
    val record = recorder.onFixes("owner", fixes(0.0, 300)).single()

    assertTrue(record.speedLimitsChecked)
    assertEquals(1, record.counts[DrivingEventType.SPEEDING])
    val event = record.events.single()
    assertEquals(DrivingEventType.SPEEDING, event.type)
    assertEquals(SpeedLimitSource.POSTED, event.limit?.source)
    assertEquals(13.42, event.limit!!.speed, 0.01)
    assertEquals(20.0, event.peak, 0.01)
    queue.list("owner", 10).forEach { row -> assertEquals(record, open(row, row.epochId)) }
  }

  @Test
  fun aDriveWithNoSpeedLimitPackSaysSpeedingWasNotChecked() {
    val recorder = recorder()
    recorder.onFixes("owner", fixes(30.0, 150))
    val record = recorder.onFixes("owner", fixes(0.0, 300)).single()

    assertTrue(!record.speedLimitsChecked && record.events.isEmpty())
  }

  @Test
  fun aGroupLeftDuringTheDriveGetsNoCopyAndLastLocationGroupsGetNone() {
    share = CaptureHistoryShare(account = "WEEK", groups = mapOf("work" to "LAST_LOCATION"))
    val recorder = recorder()
    recorder.onFixes("owner", fixes(15.0, 100))
    keys = keys + key("joined-mid-drive", "new-epoch")
    keys = keys.filterNot { it.groupId == "family" }
    recorder.onFixes("owner", fixes(15.0, 100))
    recorder.onFixes("owner", fixes(0.0, 300))
    assertEquals(emptyList(), queue.list("owner", 10))
  }

  @Test
  fun aDriveInProgressSurvivesTheAppBeingKilledAndEndsAtItsLastFixAfterTheGap() {
    recorder().onFixes("owner", fixes(15.0, 200))
    time += 3_600_000
    val restarted = recorder()
    val finished = restarted.onFixes("owner", fixes(0.0, 1))
    assertEquals(startTime + 200_000, finished.single().end.timeMillis)
    assertEquals(2, queue.list("owner", 10).size)
  }

  @Test
  fun aRestoredDriveSkipsGroupsWhoseStartEpochIsGone() {
    recorder().onFixes("owner", fixes(15.0, 200))
    keys = listOf(key("family", "family-epoch-2"), key("work", "work-epoch-1"))
    val restarted = recorder()
    restarted.interrupt("owner")
    assertEquals(listOf("work"), queue.list("owner", 10).map { it.groupId })
  }

  @Test
  fun aStaleDriveIsFinishedWhenCaptureStartsAgain() {
    recorder().onFixes("owner", fixes(15.0, 200))
    val finished = recorder().tick("owner", time + 600_000)
    assertEquals(startTime + 200_000, finished?.end?.timeMillis)
  }

  @Test
  fun turningDriveDetectionOffThrowsAwayTheDriveInProgress() {
    val recorder = recorder()
    recorder.onFixes("owner", fixes(15.0, 200))
    recorder.discard()
    recorder.onFixes("owner", fixes(0.0, 300))
    assertEquals(emptyList(), queue.list("owner", 10))
    assertEquals(emptyList(), records.list("owner"))
    assertNull(log.read())
  }

  @Test
  fun aDriveNeverCarriesOverToAnotherAccount() {
    recorder().onFixes("owner", fixes(15.0, 200))
    val other = recorder()
    other.onFixes("someone-else", fixes(0.0, 300))
    other.interrupt("someone-else")
    assertEquals(emptyList(), queue.list("owner", 10))
    assertEquals(emptyList(), queue.list("someone-else", 10))
    assertEquals(emptyList(), records.list("someone-else"))
  }

  @Test
  fun deletingOwnDrivesRemovesTheLocalRecordAndAnyQueuedCopies() {
    val recorder = recorder()
    recorder.onFixes("owner", fixes(15.0, 200))
    val driveId = recorder.onFixes("owner", fixes(0.0, 300)).single().driveId
    assertEquals(listOf(driveId), recorder.driveIds("owner"))
    recorder.deleteDrives("owner", listOf(driveId))
    assertEquals(emptyList(), recorder.driveIds("owner"))
    assertEquals(emptyList(), queue.list("owner", 10))
  }
}
