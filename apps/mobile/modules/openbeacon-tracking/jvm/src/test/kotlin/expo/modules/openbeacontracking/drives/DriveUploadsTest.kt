package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.capture.CaptureHistoryShare
import expo.modules.openbeacontracking.crypto.DrivePosition
import expo.modules.openbeacontracking.crypto.DriveRecord
import expo.modules.openbeacontracking.crypto.DriveRecordCodec
import expo.modules.openbeacontracking.crypto.DrivingEvent
import expo.modules.openbeacontracking.crypto.DrivingEventType
import expo.modules.openbeacontracking.crypto.SealedDriveRecord
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DriveUploadsTest {
  private val start = 1_795_594_447_250L
  private val record =
    DriveRecord(
      driveId = DriveRecordCodec.newDriveId(),
      start = DrivePosition(start, 51.5074, -0.1278),
      end = DrivePosition(start + 1_380_000, 51.5521, -0.0714),
      distanceMeters = 14_210.0,
      checkedDistanceMeters = 14_210.0,
      durationSeconds = 1_320.0,
      topSpeed = 27.31,
      averageSpeed = 10.76,
      utcOffsetMinutes = 0,
      counts = DrivingEventType.entries.associateWith { if (it == DrivingEventType.HARD_BRAKING) 1 else 0 },
      passenger = false,
      speedLimitsChecked = false,
      tellGroup = true,
      events = listOf(DrivingEvent(DrivingEventType.HARD_BRAKING, 312.0, 2.0, 51.5131, -0.1022, 4.27, null)),
    )

  private fun key(
    groupId: String,
    epochId: String,
  ) = ProvisionedEpochKey(groupId, epochId, ByteArray(32) { groupId.length.toByte() }, "device-1", "trackingPoint")

  private fun open(row: DriveQueueRow): DriveRecord =
    DriveRecordCodec.open(
      SealedDriveRecord(row.driveId, row.startHour, row.nonce, row.ciphertext),
      ByteArray(32) { row.groupId.length.toByte() },
      row.groupId,
      row.epochId,
      row.senderDeviceId,
    )

  @Test
  fun queuesOneCopyPerGroupUnderTheEpochCurrentWhenTheDriveStarted() {
    val queue = InMemoryDriveQueue()
    val queued =
      DriveUploads.enqueue(
        owner = "owner",
        record = record,
        startKeys = listOf(key("family", "family-epoch-1"), key("work-group", "work-epoch-3")),
        currentGroupIds = setOf("family", "work-group"),
        historyShare = CaptureHistoryShare(),
        queue = queue,
        tellGroup = { it == "family" },
      )

    assertEquals(listOf("family", "work-group"), queued)
    val rows = queue.list("owner", 10)
    assertEquals(listOf("family-epoch-1", "work-epoch-3"), rows.map { it.epochId })
    assertTrue(rows.all { it.driveId == record.driveId && it.startHour == start / 3_600_000 && it.senderDeviceId == "device-1" })
    assertTrue(rows.all { row -> DriveRecordCodec.decode(DriveRecordCodec.encode(record)!!)!!.copy(tellGroup = row.groupId == "family") == open(row) })
  }

  @Test
  fun skipsLastLocationOnlyGroupsAndGroupsTheDeviceHasLeft() {
    val queue = InMemoryDriveQueue()
    val queued =
      DriveUploads.enqueue(
        owner = "owner",
        record = record,
        startKeys = listOf(key("family", "e1"), key("live-only", "e2"), key("left", "e3")),
        currentGroupIds = setOf("family", "live-only", "joined-after-start"),
        historyShare = CaptureHistoryShare(groups = mapOf("live-only" to CaptureHistoryShare.LAST_LOCATION)),
        queue = queue,
      )

    assertEquals(listOf("family"), queued)
    assertEquals(listOf("family"), queue.list("owner", 10).map { it.groupId })
  }

  @Test
  fun aCopyEncryptedForOneGroupIsUnreadableInAnother() {
    val queue = InMemoryDriveQueue()
    DriveUploads.enqueue("owner", record, listOf(key("family", "e1")), setOf("family"), CaptureHistoryShare(), queue)
    val row = queue.list("owner", 10).single()
    assertFailsWith<Exception> { open(row.copy(groupId = "other")) }
  }
}
