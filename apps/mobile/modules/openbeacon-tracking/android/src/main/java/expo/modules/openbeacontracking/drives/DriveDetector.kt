package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DrivePosition
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class DriveFix(
  val timeMillis: Long,
  val latitude: Double,
  val longitude: Double,
  val speed: Double?,
  val accuracy: Double?,
  val batterySaver: Boolean,
)

data class DetectedDrive(
  val start: DrivePosition,
  val end: DrivePosition,
  val distanceMeters: Double,
  val checkedDistanceMeters: Double,
  val durationSeconds: Double,
  val topSpeed: Double,
  val averageSpeed: Double,
  val fixes: List<DriveFix>,
)

data class DriveStep(
  val started: Boolean,
  val finished: DetectedDrive?,
)

class DriveDetector {
  private data class Candidate(
    val run: Int,
    val after: Int,
  )

  private val stretch = mutableListOf<DriveFix>()
  private var previous: DriveFix? = null
  private var candidate: Candidate? = null
  private var lastDrivingMillis = 0L
  private var lastMovingIndex = -1
  private var stop: DriveFix? = null
  private var walkingSince: Long? = null

  var recording = false
    private set

  val watching: Boolean
    get() = recording || candidate != null

  val wantsFastFixes: Boolean
    get() = (recording || candidate != null) && previous?.batterySaver == false

  val retainedFixes: List<DriveFix>
    get() = previous?.takeIf { it != stretch.lastOrNull() }?.let { stretch + it } ?: stretch.toList()

  fun onFix(fix: DriveFix): DriveStep {
    val accuracy = fix.accuracy
    if (accuracy == null || accuracy > MAX_ACCURACY_METERS || !fix.latitude.isFinite() || !fix.longitude.isFinite()) {
      return DriveStep(started = false, finished = null)
    }
    val last = previous
    if (last != null && fix.timeMillis <= last.timeMillis) return DriveStep(started = false, finished = null)
    val speed =
      fix.speed?.takeIf { it.isFinite() && it >= 0.0 }
        ?: last?.let {
          val seconds = (fix.timeMillis - it.timeMillis) / 1_000.0
          if (seconds <= MAX_DERIVED_SPEED_GAP_SECONDS) distanceMeters(it, fix) / seconds else null
        }
    val resolved = fix.copy(speed = speed)
    previous = resolved

    val finished =
      if (recording && fix.timeMillis - lastDrivingMillis >= END_AFTER_MILLIS) finish() else null
    if (!recording && last != null && fix.timeMillis - last.timeMillis >= END_AFTER_MILLIS) reset()
    if (speed == null) return DriveStep(started = false, finished = finished)

    if (recording) {
      stretch += resolved
      when {
        speed >= DRIVING_SPEED -> {
          lastDrivingMillis = fix.timeMillis
          lastMovingIndex = stretch.lastIndex
          stop = null
          walkingSince = null
        }
        speed < MOVING_SPEED -> {
          if (stop == null) stop = fix
          walkingSince = null
        }
        speed > WALKING_SPEED -> {
          lastMovingIndex = stretch.lastIndex
          stop = null
          walkingSince = null
        }
        else -> {
          val stoppedAt = stop
          if (stoppedAt == null) {
            lastMovingIndex = stretch.lastIndex
          } else {
            val since = walkingSince ?: fix.timeMillis.also { walkingSince = it }
            val away = distanceMeters(stoppedAt, fix)
            val walkingMillis = fix.timeMillis - since
            if (away >= WALK_AWAY_METERS || (walkingMillis >= WALK_AWAY_MILLIS && away >= MOVING_SPEED * walkingMillis / 1_000.0)) {
              return DriveStep(started = false, finished = finished ?: finish())
            }
          }
        }
      }
      return DriveStep(started = false, finished = finished)
    }

    if (speed < MOVING_SPEED) {
      stretch.clear()
      candidate = null
      return DriveStep(started = false, finished = finished)
    }
    stretch += resolved
    stretch.removeAll { fix.timeMillis - it.timeMillis > BACK_DATE_LIMIT_MILLIS }
    val current = candidate
    val driving = speed >= DRIVING_SPEED
    candidate =
      when {
        current == null -> if (driving) Candidate(run = 1, after = 0) else null
        else -> {
          val run = if (driving) current.run + 1 else 0
          when {
            run >= CONFIRM_FIXES -> Candidate(run, current.after + 1)
            current.after + 1 >= CONFIRM_FIXES -> if (driving) Candidate(run, 0) else null
            else -> Candidate(run, current.after + 1)
          }
        }
      }
    if ((candidate?.run ?: 0) < CONFIRM_FIXES) return DriveStep(started = false, finished = finished)
    candidate = null
    recording = true
    lastDrivingMillis = fix.timeMillis
    lastMovingIndex = stretch.lastIndex
    return DriveStep(started = true, finished = finished)
  }

  fun onPlaceArrive(): DetectedDrive? = if (recording) finish() else null

  fun interrupt(): DetectedDrive? {
    val drive = if (recording) finish() else null
    reset()
    return drive
  }

  fun discard() {
    reset()
  }

  private fun reset() {
    stretch.clear()
    candidate = null
    recording = false
    lastMovingIndex = -1
    stop = null
    walkingSince = null
  }

  private fun finish(): DetectedDrive? {
    val fixes = stretch.take(lastMovingIndex + 1)
    reset()
    if (fixes.size < 2) return null
    var distance = 0.0
    var checked = 0.0
    var fastSince: Long? = null
    for (index in fixes.indices) {
      val fix = fixes[index]
      if ((fix.speed ?: 0.0) > MAX_SPEED) {
        val since = fastSince ?: fix.timeMillis.also { fastSince = it }
        if (fix.timeMillis - since >= MAX_SPEED_SUSTAINED_MILLIS) return null
      } else {
        fastSince = null
      }
      if (index == 0) continue
      val before = fixes[index - 1]
      val step = distanceMeters(before, fix)
      distance += step
      if (!before.batterySaver && !fix.batterySaver) checked += step
    }
    val first = fixes.first()
    val last = fixes.last()
    val duration = (last.timeMillis - first.timeMillis) / 1_000.0
    if (distance < MIN_DISTANCE_METERS || duration < MIN_DURATION_SECONDS) return null
    return DetectedDrive(
      start = DrivePosition(first.timeMillis, first.latitude, first.longitude),
      end = DrivePosition(last.timeMillis, last.latitude, last.longitude),
      distanceMeters = distance,
      checkedDistanceMeters = checked,
      durationSeconds = duration,
      topSpeed = fixes.maxOf { it.speed ?: 0.0 },
      averageSpeed = distance / duration,
      fixes = fixes,
    )
  }

  private fun distanceMeters(from: DriveFix, to: DriveFix): Double {
    val fromLatitude = Math.toRadians(from.latitude)
    val toLatitude = Math.toRadians(to.latitude)
    val a =
      sin((toLatitude - fromLatitude) / 2).pow(2) +
        cos(fromLatitude) * cos(toLatitude) * sin(Math.toRadians(to.longitude - from.longitude) / 2).pow(2)
    return 2 * EARTH_RADIUS_METERS * asin(sqrt(a.coerceIn(0.0, 1.0)))
  }

  companion object {
    const val DRIVING_SPEED = 7.0
    const val CONFIRM_FIXES = 3
    const val MOVING_SPEED = 0.5
    const val WALKING_SPEED = 2.2
    const val WALK_AWAY_METERS = 25.0
    const val WALK_AWAY_MILLIS = 20_000L
    const val END_AFTER_MILLIS = 300_000L
    const val MIN_DISTANCE_METERS = 1_000.0
    const val MIN_DURATION_SECONDS = 120.0
    const val MAX_SPEED = 200 / 3.6
    const val MAX_SPEED_SUSTAINED_MILLIS = 30_000L
    const val MAX_ACCURACY_METERS = 20.0
    const val BACK_DATE_LIMIT_MILLIS = 600_000L
    private const val MAX_DERIVED_SPEED_GAP_SECONDS = 60.0
    private const val EARTH_RADIUS_METERS = 6_371_008.8
  }
}
