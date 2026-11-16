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
    val lastFixAt: Long = Long.MIN_VALUE,
  )

  private val states = mutableMapOf<String, DwellState>()

  fun onFix(
    places: List<PlaceGeofence>,
    latitude: Double,
    longitude: Double,
    accuracyMeters: Double?,
    timestampMillis: Long,
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
      val next =
        when {
          observedInside == null -> previous
          previous.inside == null -> previous.copy(inside = observedInside, candidateInside = null)
          observedInside == previous.inside -> previous.copy(candidateInside = null)
          previous.candidateInside != observedInside -> previous.copy(candidateInside = observedInside, candidateSince = timestampMillis)
          timestampMillis - previous.candidateSince >= DWELL_MS -> {
            crossings.add(PlaceCrossing(place, observedInside, previous.candidateSince))
            previous.copy(inside = observedInside, candidateInside = null)
          }
          else -> previous
        }
      states[place.placeId] = next.copy(lastFixAt = timestampMillis)
    }
    return crossings
  }

  fun reset() {
    states.clear()
  }

  companion object {
    const val DWELL_MS = 120_000L
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
