package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.CrashAlertCodec
import expo.modules.openbeacontracking.crypto.CrashAlertMessage
import expo.modules.openbeacontracking.crypto.CrashAlertType
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey

data class QueuedCrashAlert(
  val messageId: String,
  val alertId: String,
  val type: CrashAlertType,
  val groupId: String,
  val epochId: String,
  val senderDeviceId: String,
  val nonce: String,
  val ciphertext: String,
  val crashTimeMillis: Long,
  val sentAtMillis: Long?,
  val held: Boolean,
)

interface CrashAlertStore {
  fun load(): List<QueuedCrashAlert>

  fun save(alerts: List<QueuedCrashAlert>)
}

class InMemoryCrashAlertStore : CrashAlertStore {
  private var alerts = emptyList<QueuedCrashAlert>()

  override fun load() = alerts

  override fun save(alerts: List<QueuedCrashAlert>) {
    this.alerts = alerts
  }
}

class CrashAlertOutbox(
  private val store: CrashAlertStore,
) {
  @Synchronized
  fun queueCrash(
    suspicion: CrashSuspicion,
    placeLabel: String?,
    keys: List<ProvisionedEpochKey>,
    senderDeviceId: String,
    sentAtMillis: Long,
  ): String {
    val alertId = CrashAlertCodec.newId()
    val message = crashMessage(alertId, suspicion, placeLabel, sharingUntil(sentAtMillis))
    store.save(store.load() + seal(message, currentKeys(keys, senderDeviceId), held = { false }))
    return alertId
  }

  @Synchronized
  fun queueOk(
    alertId: String,
    suspicion: CrashSuspicion,
    placeLabel: String?,
    keys: List<ProvisionedEpochKey>,
    okAtMillis: Long,
  ): Boolean {
    val alerts = store.load()
    val crashCopies = alerts.filter { it.alertId == alertId && it.type == CrashAlertType.CRASH }
    val reached = crashCopies.filter { it.sentAtMillis != null }.map { it.groupId }.toSet()
    val senderDeviceId = crashCopies.firstOrNull()?.senderDeviceId ?: return false
    val message =
      crashMessage(alertId, suspicion, placeLabel, okAtMillis).copy(
        type = CrashAlertType.OK,
        messageId = CrashAlertCodec.newId(),
        okAtMillis = okAtMillis,
      )
    val groups = crashCopies.map { it.groupId }.toSet()
    val okCopies = seal(message, currentKeys(keys, senderDeviceId).filter { it.groupId in groups }, held = { it !in reached })
    store.save(alerts.filterNot { it.alertId == alertId && it.type == CrashAlertType.CRASH && it.sentAtMillis == null } + okCopies)
    return reached.isNotEmpty()
  }

  private fun crashMessage(
    alertId: String,
    suspicion: CrashSuspicion,
    placeLabel: String?,
    sharingUntilMillis: Long,
  ) = CrashAlertMessage(
    type = CrashAlertType.CRASH,
    messageId = alertId,
    alertId = alertId,
    crashTimeMillis = suspicion.timeMillis,
    latitude = suspicion.latitude,
    longitude = suspicion.longitude,
    speedBefore = suspicion.speedBefore.takeIf { it.isFinite() && it >= 0 } ?: 0.0,
    sharingUntilMillis = sharingUntilMillis,
    okAtMillis = null,
    placeLabel = placeLabel,
  )

  @Synchronized
  fun waiting(nowMillis: Long): List<QueuedCrashAlert> =
    store.load().filter { it.sentAtMillis == null && !it.held && nowMillis < it.crashTimeMillis + GIVE_UP_MILLIS }

  @Synchronized
  fun markSent(
    copies: List<Pair<String, String>>,
    sentAtMillis: Long,
  ) {
    val sent = copies.toSet()
    store.save(
      store.load().map { alert ->
        when {
          (alert.messageId to alert.groupId) in sent && alert.sentAtMillis == null -> alert.copy(sentAtMillis = sentAtMillis)
          alert.held && (alert.alertId to alert.groupId) in sent -> alert.copy(held = false)
          else -> alert
        }
      },
    )
  }

  @Synchronized
  fun drop(copies: List<Pair<String, String>>) {
    val dropped = copies.toSet()
    store.save(store.load().filterNot { (it.messageId to it.groupId) in dropped })
  }

  @Synchronized
  fun expire(nowMillis: Long): List<String> {
    val alerts = store.load()
    val expired = alerts.filter { nowMillis >= it.crashTimeMillis + GIVE_UP_MILLIS }
    if (expired.isEmpty()) return emptyList()
    store.save(alerts - expired.toSet())
    return expired
      .groupBy { it.alertId }
      .filterValues { copies -> copies.any { it.type == CrashAlertType.CRASH } && copies.none { it.type == CrashAlertType.CRASH && it.sentAtMillis != null } }
      .keys
      .toList()
  }

  @Synchronized
  fun deliveries(alertId: String): Map<String, Long?>? =
    store
      .load()
      .filter { it.alertId == alertId && it.type == CrashAlertType.CRASH }
      .takeIf { it.isNotEmpty() }
      ?.associate { it.groupId to it.sentAtMillis }

  @Synchronized
  fun clear() {
    store.save(emptyList())
  }

  private fun currentKeys(
    keys: List<ProvisionedEpochKey>,
    senderDeviceId: String,
  ) = keys.filter { it.senderDeviceId == senderDeviceId }.groupBy { it.groupId }.map { it.value.last() }

  private fun seal(
    message: CrashAlertMessage,
    keys: List<ProvisionedEpochKey>,
    held: (String) -> Boolean,
  ) = keys.mapNotNull { key ->
    CrashAlertCodec.seal(message, key.epochKey, key.groupId, key.epochId, key.senderDeviceId)?.let { sealed ->
      QueuedCrashAlert(
        messageId = message.messageId,
        alertId = message.alertId,
        type = message.type,
        groupId = key.groupId,
        epochId = key.epochId,
        senderDeviceId = key.senderDeviceId,
        nonce = sealed.nonce,
        ciphertext = sealed.ciphertext,
        crashTimeMillis = message.crashTimeMillis,
        sentAtMillis = null,
        held = held(key.groupId),
      )
    }
  }

  companion object {
    const val GIVE_UP_MILLIS = 2 * 3_600_000L
    const val SHARING_MILLIS = 15 * 60_000L

    fun sharingUntil(sentAtMillis: Long) = sentAtMillis + SHARING_MILLIS

    fun isSharing(
      untilMillis: Long?,
      nowMillis: Long,
    ) = untilMillis != null && nowMillis < untilMillis
  }
}
