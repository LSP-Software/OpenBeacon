package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.queue.CiphertextQueue
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
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
  private val sharingState: () -> SharingCaptureState = { SharingCaptureState() },
  private val historySettings: HistoryFilterSettings = HistoryFilterSettings(),
  private val loadAllowance: (List<String>) -> HistoryAllowance? = { null },
  private val saveAllowance: (List<String>, HistoryAllowance) -> Unit = { _, _ -> },
) {
  private val lastFixByKey = mutableMapOf<List<String>, Long>()
  private val filters = mutableMapOf<List<String>, HistoryFilter>()
  private val allowances = mutableMapOf<List<String>, HistoryAllowance>()

  fun onFix(
    latitude: Double,
    longitude: Double,
    timestampMillis: Long,
    speedMetersPerSecond: Double?,
    batteryLevel: Int?,
    batteryCharging: Boolean,
    captureGeneration: Long = 0L,
    fixId: Long? = null,
    accuracyMeters: Double? = null,
    live: Boolean = true,
  ): Int {
    val owner = synchronized(captureLock) {
      if (!canQueue(captureGeneration)) return 0
      queueOwner()
    } ?: return 0
    val keys = epochKeyStore.list()
    if (keys.isEmpty()) {
      return 0
    }
    if (!latitude.isFinite() || !longitude.isFinite()) return 0

    val captureId = newId()
    val queuedAt = nowMillis()
    val fix = HistoryFix(latitude, longitude, timestampMillis, accuracyMeters, speedMetersPerSecond, batteryLevel, batteryCharging, fixId)
    val (sharing, planned) = synchronized(captureLock) {
      val sharing = sharingState()
      if (!sharing.canCapture(timestampMillis, queuedAt)) return 0
      val streams = keys.associateBy { key -> listOf(owner, key.groupId, key.epochId, key.senderDeviceId, key.kind, sharing.revisionPrefix) }
      filters.keys.retainAll(streams.keys)
      lastFixByKey.keys.retainAll(streams.keys)
      sharing to streams.flatMap { (stream, key) ->
        if (fixId != null && lastFixByKey[stream] == fixId) return@flatMap emptyList()
        if (fixId != null) lastFixByKey[stream] = fixId
        val records = filters.getOrPut(stream) { HistoryFilter(historySettings) }.onFix(fix) { takeAllowance(listOf(owner, key.groupId), queuedAt) }
        val rows = records.map { record -> Triple(key, record, if (record.stayUntil == null) CiphertextQueueRow.ROLE_POINT else CiphertextQueueRow.ROLE_STAY) }
        if (live && records.none { it.stayUntil == null && it.fix == fix }) rows + Triple(key, HistoryRecord(fix), CiphertextQueueRow.ROLE_LIVE) else rows
      }
    }
    if (planned.isEmpty()) return 0

    val rows =
      planned.map { (key, record, role) ->
        val point = record.fix
        val plaintext =
          GroupPayloadEncrypt
            .encodeTrackingPointV1Json(
              latitude = point.latitude,
              longitude = point.longitude,
              timestamp = formatTrackingTimestamp(point.timestampMillis),
              speed = point.speedMetersPerSecond,
              batteryLevel = point.batteryLevel,
              batteryCharging = point.batteryCharging,
            )?.toByteArray(Charsets.UTF_8) ?: return 0
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
          clientPointId = if (bootId != null && point.fixId != null) {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key.epochKey, "HmacSHA256"))
            val parts = listOf("openbeacon.tracking-point-id.v1", owner, key.groupId, key.epochId, key.senderDeviceId, key.kind, bootId, point.fixId.toString())
            val context = (if (role == CiphertextQueueRow.ROLE_POINT) parts else parts + role)
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
          role = role,
        )
      }

    return synchronized(captureLock) {
      if (!canQueue(captureGeneration)) return@synchronized 0
      if (queueOwner() != owner) return@synchronized 0
      if (sharingState() != sharing || !sharing.canCapture(timestampMillis, nowMillis())) return@synchronized 0
      ciphertextQueue.insertAll(rows.map { it.copy(owner = owner, clientPointId = sharing.revisionPrefix + it.clientPointId) })
    }
  }

  private fun takeAllowance(
    group: List<String>,
    now: Long,
  ): Boolean {
    val current = allowances[group] ?: loadAllowance(group) ?: HistoryAllowance.full(now, historySettings)
    val next = current.take(now, historySettings)
    allowances[group] = next ?: current
    if (next != null) saveAllowance(group, next)
    return next != null
  }
}

internal fun formatTrackingTimestamp(epochMillis: Long): String {
  val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
  formatter.timeZone = TimeZone.getTimeZone("UTC")
  return formatter.format(Date(epochMillis))
}
