package expo.modules.openbeacontracking.places

import expo.modules.openbeacontracking.capture.PlaceDwellDetector
import expo.modules.openbeacontracking.capture.SharingCaptureState
import java.util.UUID

class PlaceDetection(
  private val store: PlaceStore,
  private val queue: PlaceTransitionQueue,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val detector = PlaceDwellDetector()
  private var places: List<PlaceGeofence>? = null

  @Synchronized
  fun onFix(
    owner: String,
    deviceId: String,
    sharing: SharingCaptureState,
    nowMillis: Long,
    latitude: Double,
    longitude: Double,
    accuracyMeters: Double?,
    timestampMillis: Long,
    speedMetersPerSecond: Double?,
    onArrive: () -> Unit = {},
  ): Int {
    if (!sharing.canCapture(timestampMillis, nowMillis)) {
      detector.reset()
      return 0
    }
    if (timestampMillis > nowMillis + MAX_FUTURE_FIX_MILLIS) return 0
    val current = places ?: store.list().also { places = it }
    val crossings = detector.onFix(current, latitude, longitude, accuracyMeters, timestampMillis, speedMetersPerSecond)
    if (crossings.any { it.arrived }) onArrive()
    val rows =
      crossings.filter { it.place.sharesTransitions }.map { crossing ->
        PlaceTransitionRow(
          clientId = newId(),
          owner = owner,
          senderDeviceId = deviceId,
          groupId = crossing.place.groupId,
          placeId = crossing.place.placeId,
          direction = if (crossing.arrived) PlaceTransitionRow.ARRIVE else PlaceTransitionRow.LEAVE,
          occurredAt = crossing.occurredAt,
        )
      }
    queue.insert(rows)
    return rows.size
  }

  @Synchronized
  fun setGroupPlaces(groupId: String, groupPlaces: List<PlaceGeofence>) {
    store.replaceGroup(groupId, groupPlaces)
    places = null
    queue.deleteByGroupExcept(groupId, groupPlaces.filter { it.sharesTransitions }.map { it.placeId })
  }

  @Synchronized
  fun removeGroups(groupIds: List<String>?) {
    store.removeGroups(groupIds)
    places = null
    if (groupIds == null) queue.deleteByOwner(null) else queue.deleteByGroups(groupIds)
  }

  @Synchronized
  fun onSharingChanged(owner: String, sharing: SharingCaptureState, nowMillis: Long) {
    detector.reset()
    if (sharing.isPaused(nowMillis)) queue.deleteByOwner(owner)
  }

  @Synchronized
  fun isConfirming(nowMillis: Long): Boolean = detector.isConfirming(nowMillis)

  @Synchronized
  fun groups(): Set<String> = store.groups()

  @Synchronized
  fun restart() {
    detector.reset()
  }

  @Synchronized
  fun hasQueued(owner: String): Boolean = queue.hasAny(owner)

  @Synchronized
  fun queued(owner: String, limit: Int): List<PlaceTransitionRow> = queue.list(owner, limit)

  @Synchronized
  fun acknowledge(clientIds: List<String>) {
    queue.deleteByClientIds(clientIds)
  }

  companion object {
    const val MAX_FUTURE_FIX_MILLIS = 5 * 60_000L
  }
}
