package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.crypto.EncryptedGroupPayload
import expo.modules.openbeacontracking.crypto.TrackingPointCodec
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.openbeacontracking.queue.InMemoryCiphertextQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CapturePipelineTest {
  @Test
  fun theCapturePathDoesNotUseJavaTimeWhichAndroid7Lacks() {
    val source = java.io.File("../android/src/main/java/expo/modules/openbeacontracking/capture/CapturePipeline.kt").readText()
    assertTrue("java.time" !in source)
  }

  @Test
  fun sharingRevisionTravelsWithTheCapturedPointAndOldFixesAreSkipped() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val cutoff = java.time.Instant.parse("2026-07-13T18:45:00.000Z").toEpochMilli()
    var state = SharingCaptureState(revisionPrefix = "s1.2:", resumeAfter = cutoff)
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, sharingState = { state })
    assertEquals(0, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:00.000Z"), null, 80, false))
    assertEquals(1, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:01.000Z"), null, 80, false))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single().clientPointId.startsWith("s1.2:"))
    state = state.copy(paused = true)
    assertEquals(0, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:02.000Z"), null, 80, false))
  }

  @Test
  fun pausingDuringEncryptionPreventsQueueingTheFix() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    var state = SharingCaptureState()
    var ids = 0
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, sharingState = { state }, newId = {
      ids += 1
      if (ids == 2) state = SharingCaptureState(paused = true, revisionPrefix = "s0.1:")
      "point-$ids"
    })
    assertEquals(0, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:00.000Z"), null, 80, false))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).isEmpty())
  }

  @Test
  fun fixIdentityIsStableAcrossRestartsAndOutOfOrderRedelivery() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    fun pipeline(owner: String = "server-a/user-a", bootId: String = "boot-1") =
      CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { owner }, bootId = bootId)
    fun capture(pipeline: CapturePipeline, id: Long) =
      pipeline.onFix(51.5, -0.1, at("2026-07-13T18:45:00.000Z"), null, 80, false, fixId = id)

    assertEquals(1, capture(pipeline(), 100))
    val original = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single()
    assertEquals(1, capture(pipeline(), 101))
    assertEquals(0, capture(pipeline(), 100))
    queue.deleteByIds(listOf(original.id))
    assertEquals(1, capture(pipeline(), 100))
    val retried = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).last()
    assertEquals(original.clientPointId, retried.clientPointId)
    assertEquals(1, capture(pipeline(bootId = "boot-2"), 100))
    assertEquals(1, capture(pipeline(owner = "server-b/user-a"), 100))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.clientPointId }.toSet().size == 4)
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32) { 1 }, "device_1", "trackingPoint")))
    assertEquals(1, capture(pipeline(), 100))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).last().clientPointId != original.clientPointId)
  }

  @Test
  fun repeatedFixIsQueuedOncePerEpoch() {
    val keys = InMemoryEpochKeyStore()
    val first = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    keys.replaceAll(listOf(first))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "test" })
    fun capture(id: Long) = pipeline.onFix(51.5, -0.1, at("2026-07-13T18:45:00.000Z"), null, 80, false, fixId = id)

    assertEquals(1, capture(100))
    assertEquals(0, capture(100))
    keys.replaceAll(listOf(first, first.copy(groupId = "group_b", epochId = "epoch_b")))
    assertEquals(1, capture(100))
    assertEquals(2, capture(101))
    assertEquals(listOf("group_a", "group_b", "group_a", "group_b"), queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.groupId })
  }

  @Test
  fun oldFixCannotBeQueuedAfterCaptureStopsAndRestarts() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey(
      groupId = "group_a", epochId = "epoch_a", epochKey = ByteArray(32),
      senderDeviceId = "device_1", kind = "trackingPoint",
    )))
    val queue = InMemoryCiphertextQueue()
    val commands = CaptureCommandState()
    val previousGeneration = commands.start()
    commands.stop()
    commands.start()
    val pipeline = CapturePipeline(queueOwner = { "test" }, epochKeyStore = keys, ciphertextQueue = queue, canQueue = { commands.isCurrent(it) })
    assertEquals(0, pipeline.onFix(51.5, -0.1, at("2026-07-13T18:45:00.000Z"), null, 80, false, previousGeneration))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).isEmpty())
  }

  @Test
  fun stoppingCaptureDuringEncryptionPreventsQueueingTheFix() {
    val keyStore = InMemoryEpochKeyStore()
    keyStore.replaceAll(listOf(ProvisionedEpochKey(
      groupId = "group_a", epochId = "epoch_a", epochKey = ByteArray(32),
      senderDeviceId = "device_1", kind = "trackingPoint",
    )))
    val queue = InMemoryCiphertextQueue()
    val lock = Any()
    val started = CountDownLatch(1)
    val resume = CountDownLatch(1)
    var enabled = true
    var inserted = -1
    val pipeline = CapturePipeline(
        queueOwner = { "test" },
      epochKeyStore = keyStore,
      ciphertextQueue = queue,
      captureLock = lock,
      canQueue = { enabled },
      newId = {
        started.countDown()
        check(resume.await(5, TimeUnit.SECONDS))
        java.util.UUID.randomUUID().toString()
      },
    )
    val worker = thread {
      inserted = pipeline.onFix(51.5, -0.1, at("2026-07-13T18:45:00.000Z"), null, 80, false)
    }
    assertTrue(started.await(5, TimeUnit.SECONDS))
    synchronized(lock) { enabled = false }
    resume.countDown()
    worker.join(5_000)
    assertEquals(0, inserted)
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).isEmpty())
  }

  @Test
  fun onFixSkipsWhenNoKeysAreProvisioned() {
    val queue = InMemoryCiphertextQueue()
    val pipeline =
      CapturePipeline(
        queueOwner = { "test" },
        epochKeyStore = InMemoryEpochKeyStore(),
        ciphertextQueue = queue,
      )

    val inserted =
      pipeline.onFix(
        latitude = 51.5074,
        longitude = -0.1278,
        timestampMillis = at("2026-07-13T18:45:00.000Z"),
        speedMetersPerSecond = 1.4,
        batteryLevel = 72,
        batteryCharging = false,
      )

    assertEquals(0, inserted)
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 100).size)
  }

  @Test
  fun onFixDropsAFixWithNonFiniteCoordinates() {
    val keyStore = InMemoryEpochKeyStore()
    keyStore.replaceAll(
      listOf(
        ProvisionedEpochKey(
          groupId = "group_a",
          epochId = "epoch_a",
          epochKey = ByteArray(32),
          senderDeviceId = "device_1",
          kind = "trackingPoint",
        ),
      ),
    )
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(queueOwner = { "test" }, epochKeyStore = keyStore, ciphertextQueue = queue)

    val inserted =
      pipeline.onFix(
        latitude = Double.NaN,
        longitude = -0.1278,
        timestampMillis = at("2026-07-13T18:45:00.000Z"),
        speedMetersPerSecond = 1.4,
        batteryLevel = null,
        batteryCharging = false,
      )

    assertEquals(0, inserted)
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).isEmpty())
  }

  @Test
  fun onFixFansOutOneCiphertextPerProvisionedGroupWithoutPlaintext() {
    val keyStore = InMemoryEpochKeyStore()
    val queue = InMemoryCiphertextQueue()
    val epochKey = ByteArray(32) { index -> index.toByte() }

    keyStore.replaceAll(
      listOf(
        ProvisionedEpochKey(
          groupId = "group_a",
          epochId = "epoch_a",
          epochKey = epochKey,
          senderDeviceId = "device_1",
          kind = "trackingPoint",
        ),
        ProvisionedEpochKey(
          groupId = "group_b",
          epochId = "epoch_b",
          epochKey = epochKey,
          senderDeviceId = "device_1",
          kind = "trackingPoint",
        ),
      ),
    )

    var nextId = 0
    val pipeline =
      CapturePipeline(
        queueOwner = { "test" },
        epochKeyStore = keyStore,
        ciphertextQueue = queue,
        nowMillis = { 1_721_000_000_000L },
        newId = {
          nextId += 1
          "id_$nextId"
        },
      )

    val inserted =
      pipeline.onFix(
        latitude = 51.5074,
        longitude = -0.1278,
        timestampMillis = at("2026-07-13T18:45:00.000Z"),
        speedMetersPerSecond = null,
        batteryLevel = 40,
        batteryCharging = true,
      )

    val pending = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 100)
    assertEquals(2, inserted)
    assertEquals(2, pending.size)
    assertEquals(setOf("group_a", "group_b"), pending.map { it.groupId }.toSet())
    assertEquals(1, pending.map { it.captureId }.toSet().size)
    assertEquals(2, pending.map { it.clientPointId }.toSet().size)
    assertTrue(pending.all { it.algorithm == GroupPayloadEncrypt.ALGORITHM })
    assertTrue(pending.all { it.kind == "trackingPoint" })

    val expectedPlaintext =
      TrackingPointCodec.encode(
        latitude = 51.5074,
        longitude = -0.1278,
        timestampMillis = at("2026-07-13T18:45:00.000Z"),
        stayUntilMillis = null,
        accuracyMeters = null,
        speedMetersPerSecond = null,
        batteryLevel = 40,
        batteryCharging = true,
      )!!

    assertTrue(pending.none { row ->
      GroupPayloadEncrypt.decodeBase64(row.ciphertext).toList()
        .windowed(expectedPlaintext.size).contains(expectedPlaintext.toList())
    })

    for (row in pending) {
      val decrypted =
        GroupPayloadEncrypt.decryptGroupPayload(
          epochKey = epochKey,
          encryptedPayload =
            EncryptedGroupPayload(
              algorithm = row.algorithm,
              ciphertext = row.ciphertext,
              epochId = row.epochId,
              groupId = row.groupId,
              kind = row.kind,
              nonce = row.nonce,
              senderDeviceId = row.senderDeviceId,
            ),
        )
      assertEquals(expectedPlaintext.toList(), decrypted.toList())
    }
  }

  @Test
  fun liveFixesKeepOnlyTheNewestLiveRowWhileHistoryKeepsItsOwnPoints() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, bootId = "boot")
    val start = at("2026-07-13T18:45:00.000Z")
    for (step in 0L until 6L) {
      pipeline.onFix(51.5, -0.1 + step * 0.0002, start + step * 10_000L, 1.4, 80, false, fixId = step + 1, live = step != 5L)
    }
    val pending = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10)
    assertEquals(listOf(CiphertextQueueRow.ROLE_POINT, CiphertextQueueRow.ROLE_LIVE), pending.map { it.role })
    assertEquals(start + 40_000L to null, decrypt(pending.last()))
  }

  @Test
  fun stayUpdatesReuseTheArrivalIdAndReplaceOnlyPendingRows() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, bootId = "boot")
    val start = at("2026-07-13T18:45:00.000Z")
    fun still(minute: Long) = pipeline.onFix(51.5, -0.1, start + minute * 60_000L, 0.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = false)
    for (minute in 0L..3L) still(minute)
    val arrival = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single { it.role == CiphertextQueueRow.ROLE_STAY }
    queue.markInFlight(listOf(arrival.id), attemptedAt = 1L)
    for (minute in 4L..8L) still(minute)
    val update = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single { it.role == CiphertextQueueRow.ROLE_STAY }
    assertEquals(arrival.clientPointId, update.clientPointId)
    assertEquals(1, queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10).size)
    for (minute in 9L..13L) still(minute)
    val stays = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.role == CiphertextQueueRow.ROLE_STAY }
    assertEquals(listOf(arrival.clientPointId), stays.map { it.clientPointId })
    assertEquals(start to start + 13 * 60_000L, decrypt(stays.single()))
    val point = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).first { it.role == CiphertextQueueRow.ROLE_POINT }
    assertTrue(point.clientPointId != arrival.clientPointId)
  }

  @Test
  fun aNewSharingRevisionStartsAFreshRouteAndAnEmptyAllowanceSendsOnlyLiveRows() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    var state = SharingCaptureState(revisionPrefix = "s1.1:")
    val saved = mutableMapOf<List<String>, HistoryAllowance>()
    val start = at("2026-07-13T18:45:00.000Z")
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, nowMillis = { start }, sharingState = { state }, saveAllowance = { group, allowance -> saved[group] = allowance })
    assertEquals(1, pipeline.onFix(51.5, -0.1, start, 1.4, 80, false, live = false))
    assertEquals(0, pipeline.onFix(51.5, -0.1, start + 1_000L, 1.4, 80, false, live = false))
    state = SharingCaptureState(revisionPrefix = "s1.2:")
    assertEquals(1, pipeline.onFix(51.5, -0.1, start + 2_000L, 1.4, 80, false, live = false))
    assertEquals(2_878.0, saved.getValue(listOf("owner", "group_a")).tokens)

    val emptyQueue = InMemoryCiphertextQueue()
    val empty = CapturePipeline(epochKeyStore = keys, ciphertextQueue = emptyQueue, queueOwner = { "owner" }, nowMillis = { start }, loadAllowance = { HistoryAllowance(0.0, start) })
    assertEquals(1, empty.onFix(51.5, -0.1, start, 1.4, 80, false))
    assertEquals(listOf(CiphertextQueueRow.ROLE_LIVE), emptyQueue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.role })
  }

  private fun decrypt(row: CiphertextQueueRow): Pair<Long, Long?> {
    val point = java.nio.ByteBuffer.wrap(
      GroupPayloadEncrypt.decryptGroupPayload(
        ByteArray(32),
        EncryptedGroupPayload(row.algorithm, row.ciphertext, row.epochId, row.groupId, row.kind, row.nonce, row.senderDeviceId),
      ),
    )
    val time = (point.getShort(9).toLong() and 0xFFFF shl 32) or (point.getInt(11).toLong() and 0xFFFFFFFFL)
    return time to if (point.get(22).toInt() == 1) time + (point.getShort(15).toLong() and 0xFFFF) * 60_000L else null
  }

  @Test
  fun queueSeparatesOwnersAndLeavesLegacyRowsUnclaimed() {
    val queue = InMemoryCiphertextQueue()
    val row = CiphertextQueueRow(
      clientPointId = "point",
      captureId = "capture",
      groupId = "group",
      epochId = "epoch",
      senderDeviceId = "device",
      kind = "trackingPoint",
      algorithm = GroupPayloadEncrypt.ALGORITHM,
      nonce = "nonce",
      ciphertext = "cipher",
      queuedAt = 1L,
    )
    queue.insertAll(listOf(row, row.copy(clientPointId = "a", owner = "server-a/user-a"), row.copy(clientPointId = "b", owner = "server-a/user-b"), row.copy(clientPointId = "c", owner = "server-b/user-a")))
    val ownerRows = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a")
    assertEquals(1, ownerRows.size)
    assertEquals("server-a/user-a", ownerRows.single().owner)
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", ownerRows.single().id).size)
    assertEquals(4, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).size)
  }

  @Test
  fun queueFlushHelpersMarkDeleteAndRequeue() {
    val queue = InMemoryCiphertextQueue()
    queue.insertAll(
      listOf(
        CiphertextQueueRow(
          clientPointId = "point_1",
          captureId = "capture_1",
          groupId = "group_a",
          epochId = "epoch_a",
          senderDeviceId = "device_1",
          kind = "trackingPoint",
          algorithm = GroupPayloadEncrypt.ALGORITHM,
          nonce = "nonce",
          ciphertext = "cipher",
          queuedAt = 1L,
        ),
      ),
    )

    val pending = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10)
    assertEquals(1, pending.size)

    queue.markInFlight(listOf(pending[0].id), attemptedAt = 2L)
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).size)
    val inFlight = queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10)
    assertEquals(1, inFlight.size)
    assertEquals(1, inFlight[0].attemptCount)
    assertEquals(2L, inFlight[0].lastAttemptAt)

    queue.requeue(listOf(inFlight[0].id), attemptedAt = 3L, error = "transient")
    val requeued = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10)
    assertEquals(1, requeued.size)
    assertEquals("transient", requeued[0].lastError)
    assertEquals(3L, requeued[0].lastAttemptAt)

    queue.deleteByIds(listOf(requeued[0].id))
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).size)
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10).size)
  }
}

private fun at(iso: String) = java.time.Instant.parse(iso).toEpochMilli()
