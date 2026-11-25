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
    assertTrue(Regex("^s1\\.2:[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$").matches(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single().clientPointId))
    state = state.copy(paused = true)
    assertEquals(0, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:02.000Z"), null, 80, false))
  }

  @Test
  fun membersCanTellWhenDriveDetectionIsOffFromTheLocationItself() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    var off = false
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, driveDetectionOff = { off })
    pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:00.000Z"), null, 80, false)
    off = true
    pipeline.onFix(51.5, 0.0, at("2026-07-13T18:46:00.000Z"), null, 80, false)
    val flags =
      queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { row ->
        GroupPayloadEncrypt.decryptGroupPayload(
          ByteArray(32),
          EncryptedGroupPayload(row.algorithm, row.ciphertext, row.epochId, row.groupId, row.kind, row.nonce, row.senderDeviceId),
        )[22].toInt()
      }
    assertEquals(listOf(0, 2), flags)
  }

  @Test
  fun membersCanTellWhenCrashAlertsAreOffFromTheLocationItself() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    var off = false
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, crashAlertsOff = { off })
    pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:00.000Z"), null, 80, false)
    off = true
    pipeline.onFix(51.5, 0.0, at("2026-07-13T18:46:00.000Z"), null, 80, false)
    val flags =
      queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { row ->
        GroupPayloadEncrypt.decryptGroupPayload(
          ByteArray(32),
          EncryptedGroupPayload(row.algorithm, row.ciphertext, row.epochId, row.groupId, row.kind, row.nonce, row.senderDeviceId),
        )[22].toInt()
      }
    assertEquals(listOf(0, 4), flags)
  }

  @Test
  fun aGroupWhoseKeyCannotEncryptDoesNotBlockTheOtherGroups() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(
      listOf(
        ProvisionedEpochKey("broken", "epoch", ByteArray(16), "tablet", "trackingPoint"),
        ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint"),
      ),
    )
    val queue = InMemoryCiphertextQueue()
    val failures = mutableListOf<String>()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, onRowFailure = { groupId, _ -> failures += groupId })

    assertEquals(1, pipeline.onFix(51.5, 0.0, at("2026-07-13T18:45:00.000Z"), null, 80, false))
    assertEquals(listOf("group"), queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.groupId })
    assertEquals(listOf("broken"), failures)
  }

  @Test
  fun pausingDuringEncryptionPreventsQueueingTheFix() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    var state = SharingCaptureState()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, sharingState = { state }, newPointId = {
      state = SharingCaptureState(paused = true, revisionPrefix = "s0.1:")
      ByteArray(8)
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
    assertTrue(Regex("^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$").matches(original.clientPointId))
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
  fun historyRowsCarryTheUtcHourTheyWereRecordedInAndALongStayIsSplitAtTheHour() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, bootId = "boot")
    val start = at("2026-07-13T18:50:00.000Z")
    val hour = 3_600_000L
    for (minute in 0L..20L) {
      pipeline.onFix(51.5 + minute * 0.003, -0.1, start + minute * 60_000L, 5.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = false)
    }
    for (minute in 21L..80L) {
      pipeline.onFix(51.56, -0.1, start + minute * 60_000L, 0.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = minute == 80L)
    }

    val rows = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 100)
    val points = rows.filter { it.role == CiphertextQueueRow.ROLE_POINT }
    assertEquals(points.map { (decrypt(it).first / hour).toInt() }, points.map { it.capturedHour })
    assertTrue(points.mapNotNull { it.capturedHour }.toSet().size == 2)
    val stays = rows.filter { it.role == CiphertextQueueRow.ROLE_STAY }.map { it to decrypt(it) }
    assertEquals(2, stays.size)
    val (before, after) = stays
    assertEquals(after.second.first, before.second.second)
    assertEquals(0L, after.second.first % hour)
    assertTrue(stays.all { (row, times) -> row.capturedHour == (times.first / hour).toInt() })
    assertTrue(after.first.capturedHour!! > before.first.capturedHour!!)
    assertEquals(listOf<Int?>(null), rows.filter { it.role == CiphertextQueueRow.ROLE_LIVE }.map { it.capturedHour })
  }

  @Test
  fun aLastLocationOnlyGroupQueuesOnlyLiveRowsWhileOtherGroupsKeepHistory() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(
      listOf(
        ProvisionedEpochKey("family", "epoch_f", ByteArray(32), "device_1", "trackingPoint"),
        ProvisionedEpochKey("club", "epoch_c", ByteArray(32), "device_1", "trackingPoint"),
      ),
    )
    val queue = InMemoryCiphertextQueue()
    var share = CaptureHistoryShare(account = "WEEK_1", groups = mapOf("club" to "LAST_LOCATION"))
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, bootId = "boot", historyShare = { share })
    val start = at("2026-07-13T18:50:00.000Z")
    fun move(minute: Long, live: Boolean) =
      pipeline.onFix(51.5 + minute * 0.003, -0.1, start + minute * 60_000L, 5.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = live)
    fun rolesFor(groupId: String) = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 200).filter { it.groupId == groupId }.map { it.role }

    for (minute in 0L..20L) move(minute, live = minute % 5L == 0L)
    for (minute in 21L..60L) {
      pipeline.onFix(51.56, -0.1, start + minute * 60_000L, 0.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = false)
    }

    assertEquals(listOf(CiphertextQueueRow.ROLE_LIVE), rolesFor("club"))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 200).filter { it.groupId == "club" }.all { it.capturedHour == null })
    assertTrue(CiphertextQueueRow.ROLE_POINT in rolesFor("family"))
    assertTrue(CiphertextQueueRow.ROLE_STAY in rolesFor("family"))

    share = CaptureHistoryShare(account = "LAST_LOCATION", groups = mapOf("club" to "HOURS_6"))
    val clubPointsBefore = rolesFor("club").count { it == CiphertextQueueRow.ROLE_POINT }
    val familyRowsBefore = rolesFor("family").size
    for (minute in 61L..70L) move(minute, live = false)
    assertTrue(rolesFor("club").count { it == CiphertextQueueRow.ROLE_POINT } > clubPointsBefore)
    assertEquals(familyRowsBefore, rolesFor("family").size)
  }

  @Test
  fun captureHistoryShareUsesTheGroupChoiceBeforeTheAccountSetting() {
    val share = CaptureHistoryShare(account = "LAST_LOCATION", groups = mapOf("family" to "MAXIMUM", "club" to "LAST_LOCATION"))
    assertEquals(false, share.isLiveOnly("family"))
    assertEquals(true, share.isLiveOnly("club"))
    assertEquals(true, share.isLiveOnly("new-group"))
    assertEquals(false, CaptureHistoryShare().isLiveOnly("new-group"))
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

  @Test
  fun stayUpdatesKeepTheArrivalIdWithoutABootOrFixId() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" })
    val start = at("2026-07-13T18:45:00.000Z")
    for (minute in 0L..13L) {
      pipeline.onFix(51.5, -0.1, start + minute * 60_000L, 0.0, 80, false, accuracyMeters = 5.0, live = false)
      queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.role == CiphertextQueueRow.ROLE_STAY }.forEach { queue.markInFlight(listOf(it.id), attemptedAt = 1L) }
    }
    val stays = queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10)
    assertEquals(3, stays.size)
    assertEquals(1, stays.map { it.clientPointId }.toSet().size)
    assertEquals(start to start + 13 * 60_000L, decrypt(stays.last()))
  }

  @Test
  fun aRecordThatCannotBeEncodedIsSkippedWithoutDroppingTheOthers() {
    val keys = InMemoryEpochKeyStore()
    val key = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    keys.replaceAll(listOf(key, key.copy(groupId = "group_b", epochId = "epoch_b")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" })
    val start = at("2026-07-13T18:45:00.000Z")
    var currentFixQueued = false
    assertEquals(2, pipeline.onFix(51.5, -0.1, start, 1.4, 80, false))
    pipeline.onFix(51.5, -0.0998, start + 10_000L, 1.4, 80, false)
    assertEquals(2, pipeline.onFix(95.0, -0.0996, start + 20_000L, 1.4, 80, false, onCurrentFixQueued = { currentFixQueued = true }))
    val pending = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.role == CiphertextQueueRow.ROLE_POINT }
    assertEquals(listOf(start, start, start + 10_000L, start + 10_000L), pending.map { decrypt(it).first })
    assertTrue(!currentFixQueued)
  }

  @Test
  fun onlyALiveRowOrAPointForTheCurrentFixSatisfiesTheLiveCadence() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" })
    val start = at("2026-07-13T18:45:00.000Z")
    fun capture(at: Long, longitude: Double, latitude: Double = 51.5, live: Boolean = false): Pair<Int, Boolean> {
      var current = false
      val queued = pipeline.onFix(latitude, longitude, at, 1.4, 80, false, accuracyMeters = 5.0, live = live, onCurrentFixQueued = { current = true })
      return queued to current
    }
    assertEquals(1 to true, capture(start, -0.1))
    assertEquals(0 to false, capture(start + 10_000L, -0.0998))
    assertEquals(1 to false, capture(start + 20_000L, -0.0998, latitude = 51.5005))
    assertEquals(2 to true, capture(start + 30_000L, -0.0998, latitude = 51.5007, live = true))

    val still = CapturePipeline(epochKeyStore = keys, ciphertextQueue = InMemoryCiphertextQueue(), queueOwner = { "owner" })
    val results = (0L..3L).map { minute ->
      var current = false
      still.onFix(51.6, -0.1, start + minute * 60_000L, 0.0, 80, false, accuracyMeters = 5.0, live = false, onCurrentFixQueued = { current = true }) to current
    }
    assertEquals(listOf(1 to true, 0 to false, 1 to true, 1 to false), results)
  }

  @Test
  fun anAllowanceSavedWithAFutureTimeStillRefills() {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")))
    val queue = InMemoryCiphertextQueue()
    val start = at("2026-07-13T18:45:00.000Z")
    var now = start
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, nowMillis = { now }, loadAllowance = { HistoryAllowance(0.0, start + 86_400_000L) })
    assertEquals(0, pipeline.onFix(51.5, -0.1, start, 1.4, 80, false, live = false))
    now = start + 31_000L
    assertEquals(1, pipeline.onFix(51.5, -0.1, now, 1.4, 80, false, live = false))
    assertEquals(listOf(CiphertextQueueRow.ROLE_POINT), queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.role })
  }

  @Test
  fun anEpochRotationMidStayClosesTheOldStayAndStartsANewOneUnderTheNewEpoch() {
    val keys = InMemoryEpochKeyStore()
    val old = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    val new = old.copy(epochId = "epoch_b", epochKey = ByteArray(32) { 2 })
    keys.replaceAll(listOf(old))
    val queue = InMemoryCiphertextQueue()
    var tokens = 2_880.0
    val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, bootId = "boot", saveAllowance = { _, allowance -> tokens = allowance.tokens })
    val start = at("2026-07-13T18:45:00.000Z")
    fun still(minute: Long) = pipeline.onFix(51.5, -0.1, start + minute * 60_000L, 0.0, 80, false, fixId = minute + 1, accuracyMeters = 5.0, live = false)
    for (minute in 0L..5L) still(minute)
    val arrival = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).single { it.role == CiphertextQueueRow.ROLE_STAY }
    queue.markInFlight(listOf(arrival.id), attemptedAt = 1L)
    val before = tokens
    keys.replacePreserving(listOf(new), emptyList())
    assertEquals(2, still(6))
    assertEquals(before - 2.0, tokens, 0.01)
    for (minute in 7L..12L) still(minute)

    val stays = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.role == CiphertextQueueRow.ROLE_STAY }
    val closing = stays.single { it.epochId == "epoch_a" }
    assertEquals(arrival.clientPointId, closing.clientPointId)
    assertEquals(start to start + 5 * 60_000L, decrypt(closing))
    val continued = stays.single { it.epochId == "epoch_b" }
    assertTrue(continued.clientPointId != arrival.clientPointId)
    assertEquals(start + 6 * 60_000L to start + 11 * 60_000L, decrypt(continued, new.epochKey))
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).none { it.epochId == "epoch_b" && it.role == CiphertextQueueRow.ROLE_POINT })
  }

  @Test
  fun anEpochRotationMidRouteKeepsTheSameRoutePoints() {
    val old = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    val new = old.copy(epochId = "epoch_b", epochKey = ByteArray(32) { 2 })
    val start = at("2026-07-13T18:45:00.000Z")
    fun walk(rotateAt: Long?): List<Pair<String, Long>> {
      val keys = InMemoryEpochKeyStore()
      keys.replaceAll(listOf(old))
      val queue = InMemoryCiphertextQueue()
      val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" })
      for (step in 0L until 30L) {
        if (step == rotateAt) keys.replacePreserving(listOf(new), emptyList())
        pipeline.onFix(51.5, -0.1 + step * 0.0002, start + step * 10_000L, 1.4, 80, false, accuracyMeters = 5.0, live = false)
      }
      return queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 20).map { row ->
        row.epochId to decrypt(row, if (row.epochId == "epoch_a") old.epochKey else new.epochKey).first
      }
    }
    val unrotated = walk(null)
    val rotated = walk(3L)
    assertEquals(listOf(start, start + 120_000L, start + 240_000L), unrotated.map { it.second })
    assertEquals(listOf("epoch_a" to start, "epoch_b" to start + 120_000L, "epoch_b" to start + 240_000L), rotated)
  }

  @Test
  fun aSharingRevisionChangeMidStayIsACleanBreakEvenWhenTheEpochRotatesToo() {
    val old = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    val start = at("2026-07-13T18:45:00.000Z")
    for (rotate in listOf(false, true)) {
      val keys = InMemoryEpochKeyStore()
      keys.replaceAll(listOf(old))
      val queue = InMemoryCiphertextQueue()
      var state = SharingCaptureState(revisionPrefix = "s1.1:")
      val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" }, sharingState = { state })
      fun still(minute: Long) = pipeline.onFix(51.5, -0.1, start + minute * 60_000L, 0.0, 80, false, accuracyMeters = 5.0, live = false)
      for (minute in 0L..5L) still(minute)
      val before = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10)
      state = SharingCaptureState(revisionPrefix = "s1.2:")
      if (rotate) keys.replacePreserving(listOf(old.copy(epochId = "epoch_b")), emptyList())
      assertEquals(1, still(6))
      val after = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10)
      assertEquals(before, after.filter { it.clientPointId.startsWith("s1.1:") })
      val fresh = after.single { it.clientPointId.startsWith("s1.2:") }
      assertEquals(CiphertextQueueRow.ROLE_POINT, fresh.role)
      assertEquals(start + 6 * 60_000L to null, decrypt(fresh))
    }
  }

  @Test
  fun aRemovedOrRejoinedGroupGetsNoClosingStayAndStartsAfresh() {
    val first = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32), "device_1", "trackingPoint")
    val other = first.copy(groupId = "group_b", epochId = "epoch_c")
    val start = at("2026-07-13T18:45:00.000Z")
    for (rejoin in listOf(false, true)) {
      val keys = InMemoryEpochKeyStore()
      keys.replaceAll(listOf(first, other))
      val queue = InMemoryCiphertextQueue()
      val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "owner" })
      fun still(minute: Long) = pipeline.onFix(51.5, -0.1, start + minute * 60_000L, 0.0, 80, false, accuracyMeters = 5.0, live = false)
      for (minute in 0L..5L) still(minute)
      val before = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.groupId == "group_a" }
      keys.revoke(listOf("group_a"))
      if (rejoin) keys.replacePreserving(listOf(first.copy(epochId = "epoch_b")), listOf("group_b"))
      still(6)
      val after = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).filter { it.groupId == "group_a" }
      assertEquals(before, after.filter { it.epochId == "epoch_a" })
      assertEquals(if (rejoin) listOf(CiphertextQueueRow.ROLE_POINT) else emptyList(), after.filter { it.epochId == "epoch_b" }.map { it.role })
    }
  }

  private fun decrypt(
    row: CiphertextQueueRow,
    key: ByteArray = ByteArray(32),
  ): Pair<Long, Long?> {
    val point = java.nio.ByteBuffer.wrap(
      GroupPayloadEncrypt.decryptGroupPayload(
        key,
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
