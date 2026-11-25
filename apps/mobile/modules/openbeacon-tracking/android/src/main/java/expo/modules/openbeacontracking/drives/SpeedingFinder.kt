package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DrivingEvent
import expo.modules.openbeacontracking.crypto.DrivingEventType
import expo.modules.openbeacontracking.crypto.SpeedLimit
import expo.modules.openbeacontracking.crypto.SpeedLimitSource
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot

fun interface SpeedLimitRoads {
  fun roadsNear(latitude: Double, longitude: Double, radiusMeters: Double): List<PackRoadPiece>?
}

class SpeedLimitPackSet(private val packs: List<SpeedLimitPack>) : SpeedLimitRoads {
  override fun roadsNear(latitude: Double, longitude: Double, radiusMeters: Double): List<PackRoadPiece>? {
    val lonE5 = longitude * 1e5
    val latE5 = latitude * 1e5
    val covering =
      packs.filter { lonE5 >= it.minLonE5 && lonE5 <= it.maxLonE5 && latE5 >= it.minLatE5 && latE5 <= it.maxLatE5 }
    if (covering.isEmpty()) return null
    return covering.flatMap { it.roadsNear(latitude, longitude, radiusMeters) }
  }
}

data class SpeedingResult(
  val checked: Boolean,
  val events: List<DrivingEvent>,
)

object SpeedingFinder {
  const val MATCH_METERS = 20.0
  const val AMBIGUOUS_METERS = 30.0
  const val MAX_HEADING_DEGREES = 30.0
  const val MIN_HEADING_METERS = 3.0
  const val MAX_GAP_MILLIS = 5_000L
  const val MIN_SPEEDING_MILLIS = 15_000L
  const val OVER_RATIO = 1.1
  const val OVER_MARGIN = 0.89408
  private const val ROUNDING_ALLOWANCE = 0.02
  private const val METERS_PER_DEGREE = 111_320.0

  fun find(fixes: List<DriveFix>, roads: SpeedLimitRoads?): SpeedingResult {
    if (roads == null || fixes.isEmpty()) return SpeedingResult(checked = false, events = emptyList())
    val matched = fixes.indices.map { match(fixes, it, roads) }
    val limits =
      matched.indices.map { index ->
        val limit = matched[index] ?: return@map null
        val agrees =
          listOf(index - 1, index + 1).any { other ->
            other in fixes.indices &&
              matched[other] == limit &&
              abs(fixes[other].timeMillis - fixes[index].timeMillis) <= MAX_GAP_MILLIS
          }
        if (agrees) limit else null
      }

    val events = mutableListOf<Pair<Double, DrivingEvent>>()
    var runStart = -1
    for (index in 0..fixes.size) {
      val speeding = index < fixes.size && isSpeeding(fixes[index], limits[index])
      val continues =
        speeding && runStart >= 0 && fixes[index].timeMillis - fixes[index - 1].timeMillis <= MAX_GAP_MILLIS
      if (continues) continue
      if (runStart >= 0) {
        speedingEvent(fixes, limits, runStart, index - 1)?.let { events += it }
        runStart = -1
      }
      if (speeding) runStart = index
    }

    return SpeedingResult(
      checked = limits.any { it != null },
      events = events.sortedByDescending { it.first }.map { it.second },
    )
  }

  private fun isSpeeding(fix: DriveFix, limit: RoadLimit?): Boolean {
    if (limit == null || limit.tenthsKmh == 0) return false
    val speed = fix.speed ?: return false
    return speed >= limit.tenthsKmh / 36.0 * OVER_RATIO + OVER_MARGIN - ROUNDING_ALLOWANCE
  }

  private fun speedingEvent(
    fixes: List<DriveFix>,
    limits: List<RoadLimit?>,
    from: Int,
    to: Int,
  ): Pair<Double, DrivingEvent>? {
    val durationMillis = fixes[to].timeMillis - fixes[from].timeMillis
    if (durationMillis < MIN_SPEEDING_MILLIS) return null
    val peakIndex = (from..to).maxBy { fixes[it].speed ?: 0.0 }
    val peakFix = fixes[peakIndex]
    val limit = limits[peakIndex]!!
    val limitSpeed = limit.tenthsKmh / 36.0
    val peak = peakFix.speed ?: 0.0
    val duration = durationMillis / 1_000.0
    val event =
      DrivingEvent(
        type = DrivingEventType.SPEEDING,
        timeOffsetSeconds = (fixes[from].timeMillis - fixes.first().timeMillis) / 1_000.0,
        durationSeconds = duration,
        latitude = peakFix.latitude,
        longitude = peakFix.longitude,
        peak = peak,
        limit =
          SpeedLimit(
            speed = limitSpeed,
            source = if (limit.source == RoadLimitSource.Posted) SpeedLimitSource.POSTED else SpeedLimitSource.ROAD_TYPE,
          ),
      )
    return (peak - limitSpeed) / limitSpeed * duration to event
  }

  private fun match(fixes: List<DriveFix>, index: Int, roads: SpeedLimitRoads): RoadLimit? {
    val fix = fixes[index]
    if (fix.batterySaver || fix.speed == null) return null
    val heading = heading(fixes, index) ?: return null
    val pieces = roads.roadsNear(fix.latitude, fix.longitude, AMBIGUOUS_METERS) ?: return null
    val metersPerLongitude = METERS_PER_DEGREE * cos(Math.toRadians(fix.latitude))
    var best: Double? = null
    val nearby = mutableSetOf<RoadLimit>()

    for (piece in pieces) {
      var pieceDistance: Double? = null
      var pieceLimit: RoadLimit? = null
      for (point in 0 until piece.lonE5.size - 1) {
        val ax = (piece.lonE5[point] / 1e5 - fix.longitude) * metersPerLongitude
        val ay = (piece.latE5[point] / 1e5 - fix.latitude) * METERS_PER_DEGREE
        val bx = (piece.lonE5[point + 1] / 1e5 - fix.longitude) * metersPerLongitude
        val by = (piece.latE5[point + 1] / 1e5 - fix.latitude) * METERS_PER_DEGREE
        val dx = bx - ax
        val dy = by - ay
        val length = dx * dx + dy * dy
        if (length == 0.0) continue
        val along = (-(ax * dx + ay * dy) / length).coerceIn(0.0, 1.0)
        val distance = hypot(ax + dx * along, ay + dy * along)
        if (distance > AMBIGUOUS_METERS) continue
        val turn = angleBetween(heading, Math.toDegrees(atan2(dx, dy)))
        val limit =
          when {
            turn <= MAX_HEADING_DEGREES -> piece.forward
            turn >= 180 - MAX_HEADING_DEGREES && !piece.oneway -> piece.backward
            else -> null
          } ?: continue
        if (pieceDistance == null || distance < pieceDistance) {
          pieceDistance = distance
          pieceLimit = limit
        }
      }
      if (pieceDistance == null || pieceLimit == null) continue
      nearby += pieceLimit
      if (best == null || pieceDistance < best) best = pieceDistance
    }

    if (best == null || best > MATCH_METERS || nearby.size != 1) return null
    return nearby.single().takeIf { it.source != RoadLimitSource.Unknown }
  }

  private fun heading(fixes: List<DriveFix>, index: Int): Double? {
    val fix = fixes[index]
    val before = fixes.getOrNull(index - 1)?.takeIf { fix.timeMillis - it.timeMillis <= MAX_GAP_MILLIS } ?: fix
    val after = fixes.getOrNull(index + 1)?.takeIf { it.timeMillis - fix.timeMillis <= MAX_GAP_MILLIS } ?: fix
    val dx = (after.longitude - before.longitude) * METERS_PER_DEGREE * cos(Math.toRadians(fix.latitude))
    val dy = (after.latitude - before.latitude) * METERS_PER_DEGREE
    if (hypot(dx, dy) < MIN_HEADING_METERS) return null
    return Math.toDegrees(atan2(dx, dy))
  }

  private fun angleBetween(first: Double, second: Double): Double {
    val difference = abs(first - second) % 360.0
    return if (difference > 180.0) 360.0 - difference else difference
  }
}
