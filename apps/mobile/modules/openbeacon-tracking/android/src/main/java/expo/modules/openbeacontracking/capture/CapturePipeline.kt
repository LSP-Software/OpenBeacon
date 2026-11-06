package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.queue.CiphertextQueue
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class CapturePipeline(
  private val epochKeyStore: EpochKeyStore,
  private val ciphertextQueue: CiphertextQueue,
  private val nowMillis: () -> Long = { System.currentTimeMillis() },
  private val newId: () -> String = { UUID.randomUUID().toString() },
  private val captureLock: Any = Any(),
  private val canQueue: (Long) -> Boolean = { true },
  private val queueOwner: () -> String? = { null },
  private val bootId: String? = null,
) {
  private val lastFixByKey = mutableMapOf<List<String>, Long>()

  fun onFix(
    latitude: Double,
    longitude: Double,
    timestampIso: String,
    speedMetersPerSecond: Double?,
    batteryLevel: Int,
    batteryCharging: Boolean,
    captureGeneration: Long = 0L,
    fixId: Long? = null,
  ): Int {
    val owner = synchronized(captureLock) {
      if (!canQueue(captureGeneration)) return 0
      queueOwner()
    } ?: return 0
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
          clientPointId = if (bootId != null && fixId != null) {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key.epochKey, "HmacSHA256"))
            val context = listOf("openbeacon.tracking-point-id.v1", owner, key.groupId, key.epochId, key.senderDeviceId, key.kind, bootId, fixId.toString())
              .joinToString(":") { GroupPayloadEncrypt.encodeBase64(it.toByteArray(Charsets.UTF_8)) }
            GroupPayloadEncrypt.encodeBase64(mac.doFinal(context.toByteArray(Charsets.UTF_8)))
          } else {
            newId()
          },
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
      if (queueOwner() != owner) return@synchronized 0
      val scopedRows = rows.map { it.copy(owner = owner) }
      lastFixByKey.keys.retainAll(scopedRows.map { row ->
        listOf(owner, row.groupId, row.epochId, row.senderDeviceId, row.kind)
      }.toSet())
      val newRows = scopedRows.filter { row ->
        val key = listOf(owner, row.groupId, row.epochId, row.senderDeviceId, row.kind)
        fixId == null || lastFixByKey[key] != fixId
      }
      if (newRows.isEmpty()) return@synchronized 0
      val inserted = ciphertextQueue.insertAll(newRows)
      if (fixId != null) {
        for (row in newRows) {
          lastFixByKey[listOf(owner, row.groupId, row.epochId, row.senderDeviceId, row.kind)] = fixId
        }
      }
      inserted
    }
  }
}
