package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.crypto.EncryptedGroupPayload
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.openbeacontracking.queue.InMemoryCiphertextQueue
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CapturePipelineTest {
  @Test
  fun onFixSkipsWhenNoKeysAreProvisioned() {
    val queue = InMemoryCiphertextQueue()
    val pipeline =
      CapturePipeline(
        epochKeyStore = InMemoryEpochKeyStore(),
        ciphertextQueue = queue,
      )

    val inserted =
      pipeline.onFix(
        latitude = 51.5074,
        longitude = -0.1278,
        timestampIso = "2026-07-13T18:45:00.000Z",
        speedMetersPerSecond = 1.4,
        batteryLevel = 72,
        batteryCharging = false,
      )

    assertEquals(0, inserted)
    assertEquals(0, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 100).size)
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
        timestampIso = "2026-07-13T18:45:00.000Z",
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
    assertTrue(pending.none { it.ciphertext.contains("51.5074") })
    assertTrue(pending.none { it.nonce.contains("51.5074") })

    val expectedPlaintext =
      GroupPayloadEncrypt
        .encodeTrackingPointV1Json(
          latitude = 51.5074,
          longitude = -0.1278,
          timestamp = "2026-07-13T18:45:00.000Z",
          speed = null,
          batteryLevel = 40,
          batteryCharging = true,
        ).toByteArray(StandardCharsets.UTF_8)

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
