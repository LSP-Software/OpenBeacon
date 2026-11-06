package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.queue.CiphertextQueue
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import java.util.UUID

class CapturePipeline(
  private val epochKeyStore: EpochKeyStore,
  private val ciphertextQueue: CiphertextQueue,
  private val nowMillis: () -> Long = { System.currentTimeMillis() },
  private val newId: () -> String = { UUID.randomUUID().toString() },
  private val captureLock: Any = Any(),
  private val canQueue: (Long) -> Boolean = { true },
  private val queueOwner: () -> String? = { null },
) {
  fun onFix(
    latitude: Double,
    longitude: Double,
    timestampIso: String,
    speedMetersPerSecond: Double?,
    batteryLevel: Int,
    batteryCharging: Boolean,
    captureGeneration: Long = 0L,
  ): Int {
    val keys = epochKeyStore.list()
    if (keys.isEmpty()) {
      return 0
    }

    val captureId = newId()
    val queuedAt = nowMillis()
    val plaintext =
      GroupPayloadEncrypt
        .encodeTrackingPointV1Json(
          latitude = latitude,
          longitude = longitude,
          timestamp = timestampIso,
          speed = speedMetersPerSecond,
          batteryLevel = batteryLevel,
          batteryCharging = batteryCharging,
        ).toByteArray(Charsets.UTF_8)

    val rows =
      keys.map { key ->
        val encrypted =
          GroupPayloadEncrypt.encryptGroupPayload(
            epochKey = key.epochKey,
            plaintext = plaintext,
            groupId = key.groupId,
            epochId = key.epochId,
            kind = key.kind,
            senderDeviceId = key.senderDeviceId,
          )

        CiphertextQueueRow(
          clientPointId = newId(),
          captureId = captureId,
          groupId = encrypted.groupId,
          epochId = encrypted.epochId,
          senderDeviceId = encrypted.senderDeviceId,
          kind = encrypted.kind,
          algorithm = encrypted.algorithm,
          nonce = encrypted.nonce,
          ciphertext = encrypted.ciphertext,
          queuedAt = queuedAt,
          status = CiphertextQueueRow.STATUS_PENDING,
        )
      }

    return synchronized(captureLock) {
      if (!canQueue(captureGeneration)) return@synchronized 0
      val owner = queueOwner() ?: return@synchronized 0
      ciphertextQueue.insertAll(rows.map { it.copy(owner = owner) })
      rows.size
    }
  }
}
