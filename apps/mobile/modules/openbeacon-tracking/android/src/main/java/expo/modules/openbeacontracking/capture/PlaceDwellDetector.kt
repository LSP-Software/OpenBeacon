package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.places.PlaceGeofence
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class PlaceCrossing(
  val place: PlaceGeofence,
  val arrived: Boolean,
  val occurredAt: Long,
)

class PlaceDwellDetector {
  private data class DwellState(
    val place: PlaceGeofence,
    val inside: Boolean? = null,
    val candidateInside: Boolean? = null,
    val candidateSince: Long = 0L,
    val clearSince: Long? = null,
    val lastFixAt: Long = Long.MIN_VALUE,
  )

  private val states = mutableMapOf<String, DwellState>()

  fun onFix(
    places: List<PlaceGeofence>,
    latitude: Double,
    longitude: Double,
    accuracyMeters: Double?,
    timestampMillis: Long,
    speedMetersPerSecond: Double? = null,
  ): List<PlaceCrossing> {
    states.keys.retainAll(places.map { it.placeId }.toSet())
    if (accuracyMeters != null && accuracyMeters > MAX_ACCURACY_METERS) return emptyList()
    val crossings = mutableListOf<PlaceCrossing>()
    for (place in places) {
      val previous = states[place.placeId]?.takeIf { it.place == place } ?: DwellState(place)
      if (timestampMillis <= previous.lastFixAt) continue
      val distance = distanceMeters(place.latitude, place.longitude, latitude, longitude)
      val observedInside =
        when {
          distance <= place.radiusMeters -> true
          distance > place.radiusMeters + BOUNDARY_MARGIN_METERS -> false
          else -> null
        }
      val clear =
        accuracyMeters != null &&
          when (observedInside) {
            true ->
              distance + accuracyMeters <= place.radiusMeters &&
                (speedMetersPerSecond == null || speedMetersPerSecond < MAX_CLEAR_ARRIVAL_SPEED_MPS)
            false ->
              distance - accuracyMeters > place.radiusMeters + BOUNDARY_MARGIN_METERS &&
                speedMetersPerSecond != null &&
                speedMetersPerSecond >= MIN_CLEAR_DEPARTURE_SPEED_MPS
            null -> false
          }
      val next =
        when {
          observedInside == null -> previous
          previous.inside == null -> previous.copy(inside = observedInside, candidateInside = null)
          observedInside == previous.inside -> previous.copy(candidateInside = null)
          previous.candidateInside != observedInside ->
            previous.copy(candidateInside = observedInside, candidateSince = timestampMillis, clearSince = timestampMillis.takeIf { clear })
          else -> {
            val clearSince = if (clear) previous.clearSince ?: timestampMillis else null
            val clearDwellMs = if (observedInside) ARRIVAL_CLEAR_DWELL_MS else DEPARTURE_CLEAR_DWELL_MS
            if (timestampMillis - previous.candidateSince >= DWELL_MS || (clearSince != null && timestampMillis - clearSince >= clearDwellMs)) {
              crossings.add(PlaceCrossing(place, observedInside, previous.candidateSince))
              previous.copy(inside = observedInside, candidateInside = null)
            } else {
              previous.copy(clearSince = clearSince)
            }
          }
        }
      states[place.placeId] = next.copy(lastFixAt = timestampMillis)
    }
    return crossings
  }

  fun isConfirming(nowMillis: Long): Boolean =
    states.values.any { it.candidateInside != null && nowMillis - it.candidateSince < DWELL_MS }

  fun reset() {
    states.clear()
  }

  companion object {
    const val DWELL_MS = 120_000L
    const val ARRIVAL_CLEAR_DWELL_MS = 45_000L
    const val DEPARTURE_CLEAR_DWELL_MS = 30_000L
    const val MAX_CLEAR_ARRIVAL_SPEED_MPS = 1.0
    const val MIN_CLEAR_DEPARTURE_SPEED_MPS = 0.5
    const val BOUNDARY_MARGIN_METERS = 30.0
    const val MAX_ACCURACY_METERS = 200.0
    private const val EARTH_RADIUS_METERS = 6_371_008.8

    fun distanceMeters(
      fromLatitude: Double,
      fromLongitude: Double,
      toLatitude: Double,
      toLongitude: Double,
    ): Double {
      val deltaLatitude = Math.toRadians(toLatitude - fromLatitude)
      val deltaLongitude = Math.toRadians(toLongitude - fromLongitude)
      val a =
        sin(deltaLatitude / 2) * sin(deltaLatitude / 2) +
          cos(Math.toRadians(fromLatitude)) * cos(Math.toRadians(toLatitude)) * sin(deltaLongitude / 2) * sin(deltaLongitude / 2)
      return 2 * EARTH_RADIUS_METERS * asin(min(1.0, sqrt(a)))
    }
  }
}
