package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DrivingEvent
import expo.modules.openbeacontracking.crypto.DrivingEventType
import java.util.TreeMap
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

data class AccelerometerSample(
  val timeMillis: Long,
  val x: Double,
  val y: Double,
  val z: Double,
)

enum class PhoneUseSignal { SCREEN_ON, SCREEN_OFF, UNLOCKED, HANDHELD_CALL_STARTED, HANDHELD_CALL_ENDED }

data class PhoneUseChange(
  val timeMillis: Long,
  val signal: PhoneUseSignal,
)

data class FoundDrivingEvents(
  val events: List<DrivingEvent>,
  val counts: Map<DrivingEventType, Int>,
)

class DrivingEventFinder {
  private class Second {
    var x = 0.0
    var y = 0.0
    var z = 0.0
    var samples = 0
    var minMagnitude = Double.MAX_VALUE

    fun mean() = doubleArrayOf(x / samples, y / samples, z / samples)
  }

  private val seconds = TreeMap<Long, Second>()
  private val changes = mutableListOf<PhoneUseChange>()

  fun onAccelerometer(samples: List<AccelerometerSample>) {
    for (sample in samples) {
      if (!sample.x.isFinite() || !sample.y.isFinite() || !sample.z.isFinite()) continue
      val second = seconds.getOrPut(Math.floorDiv(sample.timeMillis, 1_000L)) { Second() }
      second.x += sample.x
      second.y += sample.y
      second.z += sample.z
      second.samples += 1
      second.minMagnitude = min(second.minMagnitude, sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z))
    }
  }

  fun onPhoneUse(change: PhoneUseChange) {
    val at = changes.indexOfLast { it.timeMillis <= change.timeMillis }
    changes.add(at + 1, change)
  }

  fun trimBefore(timeMillis: Long) {
    seconds.headMap(Math.floorDiv(timeMillis - BASELINE_MILLIS, 1_000L)).clear()
    val before = changes.filter { it.timeMillis < timeMillis }
    if (before.isEmpty()) return
    var screen = false
    var unlocked = false
    var call = false
    for (change in before) {
      when (change.signal) {
        PhoneUseSignal.SCREEN_ON -> screen = true
        PhoneUseSignal.SCREEN_OFF -> {
          screen = false
          unlocked = false
        }
        PhoneUseSignal.UNLOCKED -> {
          screen = true
          unlocked = true
        }
        PhoneUseSignal.HANDHELD_CALL_STARTED -> call = true
        PhoneUseSignal.HANDHELD_CALL_ENDED -> call = false
      }
    }
    changes.removeAll(before)
    changes.addAll(
      0,
      listOfNotNull(
        PhoneUseChange(timeMillis, PhoneUseSignal.SCREEN_ON).takeIf { screen },
        PhoneUseChange(timeMillis, PhoneUseSignal.UNLOCKED).takeIf { unlocked },
        PhoneUseChange(timeMillis, PhoneUseSignal.HANDHELD_CALL_STARTED).takeIf { call },
      ),
    )
  }

  fun find(fixes: List<DriveFix>): FoundDrivingEvents {
    val found = if (fixes.size < 2) emptyList() else hardEvents(fixes) + phoneUse(fixes)
    return FoundDrivingEvents(
      events = mostSevereFirst(found),
      counts = DrivingEventType.entries.associateWith { type -> found.count { it.type == type } },
    )
  }

  private fun slope(
    from: DriveFix,
    to: DriveFix,
  ): Double? {
    val seconds = (to.timeMillis - from.timeMillis) / 1_000.0
    val fromSpeed = from.speed ?: return null
    val toSpeed = to.speed ?: return null
    if (seconds <= 0 || seconds > MAX_STEP_SECONDS || from.batterySaver || to.batterySaver) return null
    return (toSpeed - fromSpeed) / seconds
  }

  private fun hardEvents(fixes: List<DriveFix>): List<DrivingEvent> {
    val evidence = axisEvidence(fixes)
    val total = DoubleArray(3) { axis -> evidence.sumOf { it[axis] } }
    val events = mutableListOf<DrivingEvent>()
    var type: DrivingEventType? = null
    var runStart = 0
    var peak = 0.0
    fun close(end: Int) {
      val runType = type ?: return
      val from = fixes[runStart]
      val to = fixes[end]
      val sign = if (runType == DrivingEventType.HARD_BRAKING) -1.0 else 1.0
      val others = DoubleArray(3) { axis -> total[axis] - (runStart + 1..end).sumOf { evidence[it][axis] } }
      val othersLength = length(others)
      val forward = if (othersLength < MIN_AXIS_EVIDENCE) null else DoubleArray(3) { others[it] / othersLength }
      if (!confirmed(from, to, sign, forward)) return
      events +=
        DrivingEvent(
          type = runType,
          timeOffsetSeconds = (from.timeMillis - fixes.first().timeMillis) / 1_000.0,
          durationSeconds = (to.timeMillis - from.timeMillis) / 1_000.0,
          latitude = from.latitude,
          longitude = from.longitude,
          peak = peak,
          limit = null,
        )
    }
    for (index in 1 until fixes.size) {
      val acceleration = slope(fixes[index - 1], fixes[index])
      val stepType =
        when {
          acceleration == null -> null
          acceleration <= -HARD_ACCELERATION -> DrivingEventType.HARD_BRAKING
          acceleration >= HARD_ACCELERATION -> DrivingEventType.RAPID_ACCELERATION
          else -> null
        }
      if (stepType != type) {
        close(index - 1)
        type = stepType
        runStart = index - 1
        peak = 0.0
      }
      if (acceleration != null && stepType != null) peak = max(peak, abs(acceleration))
    }
    close(fixes.lastIndex)
    return events
  }

  private fun axisEvidence(fixes: List<DriveFix>): List<DoubleArray> =
    (0 until fixes.size).map { index ->
      val sum = DoubleArray(3)
      if (index == 0) return@map sum
      val from = fixes[index - 1]
      val to = fixes[index]
      val acceleration = slope(from, to)?.takeIf { abs(it) >= AXIS_EVIDENCE_ACCELERATION } ?: return@map sum
      for (second in Math.floorDiv(from.timeMillis, 1_000L) until ceilSecond(to.timeMillis)) {
        val horizontal = horizontalAt(second, gravityBefore(second) ?: continue) ?: continue
        for (axis in 0..2) sum[axis] += horizontal[axis] * acceleration
      }
      sum
    }

  private fun confirmed(
    from: DriveFix,
    to: DriveFix,
    sign: Double,
    axis: DoubleArray?,
  ): Boolean {
    val startSecond = Math.floorDiv(from.timeMillis, 1_000L)
    val endSecond = ceilSecond(to.timeMillis)
    val gravity = gravityBefore(startSecond) ?: return false
    average((endSecond + 1)..(endSecond + BASELINE_SECONDS))?.let { after ->
      if (angleDegrees(gravity, after) > MAX_REORIENTATION_DEGREES) return false
    }
    if (((startSecond - 1)..(endSecond + 1)).any { (seconds[it]?.minMagnitude ?: Double.MAX_VALUE) < FREE_FALL_MAGNITUDE }) return false
    val gpsAcceleration = abs((to.speed ?: 0.0) - (from.speed ?: 0.0)) / ((to.timeMillis - from.timeMillis) / 1_000.0)
    val length = max(1L, endSecond - startSecond)
    return (-1L..1L).any { shift ->
      val values =
        (startSecond + shift until startSecond + shift + length).map { second ->
          val horizontal = horizontalAt(second, gravity) ?: return@any false
          if (axis == null) length(horizontal) else dot(horizontal, axis) * sign
        }
      values.average() >= CONFIRM_FRACTION * gpsAcceleration
    }
  }

  private fun phoneUse(fixes: List<DriveFix>): List<DrivingEvent> {
    val start = fixes.first().timeMillis
    val end = fixes.last().timeMillis
    val uses = mutableListOf<Pair<Long, Long>>()
    var screenAt: Long? = null
    var unlockedAt: Long? = null
    var callAt: Long? = null
    for (change in changes) {
      when (change.signal) {
        PhoneUseSignal.SCREEN_ON -> if (screenAt == null) screenAt = change.timeMillis
        PhoneUseSignal.UNLOCKED -> {
          if (screenAt == null) screenAt = change.timeMillis
          if (unlockedAt == null) unlockedAt = change.timeMillis
        }
        PhoneUseSignal.SCREEN_OFF -> {
          unlockedAt?.let { uses += it to change.timeMillis }
          screenAt?.let { handheld(it, change.timeMillis)?.let { use -> uses += use } }
          screenAt = null
          unlockedAt = null
        }
        PhoneUseSignal.HANDHELD_CALL_STARTED -> if (callAt == null) callAt = change.timeMillis
        PhoneUseSignal.HANDHELD_CALL_ENDED -> {
          callAt?.let { uses += it to change.timeMillis }
          callAt = null
        }
      }
    }
    unlockedAt?.let { uses += it to end }
    screenAt?.let { handheld(it, end)?.let { use -> uses += use } }
    callAt?.let { uses += it to end }

    val fast = mutableListOf<Pair<Long, Long>>()
    for (index in 1 until fixes.size) {
      val from = fixes[index - 1]
      val to = fixes[index]
      if (to.timeMillis - from.timeMillis > MAX_PHONE_USE_FIX_GAP_MILLIS) continue
      if ((from.speed ?: 0.0) >= PHONE_USE_SPEED && (to.speed ?: 0.0) >= PHONE_USE_SPEED) fast += from.timeMillis to to.timeMillis
    }
    val overlaps =
      merge(uses.map { max(it.first, start) to min(it.second, end) }).flatMap { use ->
        merge(fast).mapNotNull { stretch ->
          (max(use.first, stretch.first) to min(use.second, stretch.second)).takeIf { it.first < it.second }
        }
      }
    return merge(overlaps)
      .filter { it.second - it.first > MIN_PHONE_USE_MILLIS }
      .map { (from, to) ->
        val position = fixes.lastOrNull { it.timeMillis <= from } ?: fixes.first()
        DrivingEvent(
          type = DrivingEventType.PHONE_USE,
          timeOffsetSeconds = (from - start) / 1_000.0,
          durationSeconds = min((to - from) / 1_000.0, MAX_DURATION_SECONDS),
          latitude = position.latitude,
          longitude = position.longitude,
          peak = fixes.filter { it.timeMillis in from..to }.maxOfOrNull { it.speed ?: 0.0 } ?: (position.speed ?: 0.0),
          limit = null,
        )
      }
  }

  private fun handheld(
    from: Long,
    to: Long,
  ): Pair<Long, Long>? {
    val first = Math.floorDiv(from, 1_000L)
    val baseline = average((first - HAND_BASELINE_SECONDS) until first) ?: return null
    var tiltedSince: Long? = null
    for (second in first until ceilSecond(to)) {
      val mean = seconds[second]?.mean()
      if (mean == null || angleDegrees(baseline, mean) < HAND_TILT_DEGREES) {
        tiltedSince = null
        continue
      }
      val since = tiltedSince ?: second.also { tiltedSince = it }
      if (second - since + 1 >= HAND_TILT_SECONDS) return max(since * 1_000L, from) to to
    }
    return null
  }

  private fun gravityBefore(second: Long): DoubleArray? = average((second - BASELINE_SECONDS - 1) until second - 1)

  private fun average(range: LongRange): DoubleArray? {
    val means = range.mapNotNull { seconds[it]?.mean() }
    if (means.isEmpty()) return null
    return DoubleArray(3) { axis -> means.sumOf { it[axis] } / means.size }
  }

  private fun horizontalAt(
    second: Long,
    gravity: DoubleArray,
  ): DoubleArray? {
    val mean = seconds[second]?.mean() ?: return null
    val up = length(gravity).takeIf { it > 0 }?.let { size -> DoubleArray(3) { gravity[it] / size } } ?: return null
    val linear = DoubleArray(3) { mean[it] - gravity[it] }
    val vertical = dot(linear, up)
    return DoubleArray(3) { linear[it] - vertical * up[it] }
  }

  private fun ceilSecond(timeMillis: Long) = Math.floorDiv(timeMillis + 999, 1_000L)

  private fun merge(intervals: List<Pair<Long, Long>>): List<Pair<Long, Long>> {
    val merged = mutableListOf<Pair<Long, Long>>()
    for (interval in intervals.filter { it.first < it.second }.sortedBy { it.first }) {
      val last = merged.lastOrNull()
      if (last != null && interval.first <= last.second) {
        merged[merged.lastIndex] = last.first to max(last.second, interval.second)
      } else {
        merged += interval
      }
    }
    return merged
  }

  private fun dot(
    a: DoubleArray,
    b: DoubleArray,
  ) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  private fun length(a: DoubleArray) = sqrt(dot(a, a))

  private fun angleDegrees(
    a: DoubleArray,
    b: DoubleArray,
  ): Double {
    val lengths = length(a) * length(b)
    if (lengths == 0.0) return 180.0
    return Math.toDegrees(acos((dot(a, b) / lengths).coerceIn(-1.0, 1.0)))
  }

  companion object {
    const val HARD_ACCELERATION = 3.1
    const val PHONE_USE_SPEED = 15 / 3.6
    const val MIN_PHONE_USE_MILLIS = 3_000L
    const val CONFIRM_FRACTION = 0.5
    const val FREE_FALL_MAGNITUDE = 4.0
    const val MAX_REORIENTATION_DEGREES = 20.0
    const val HAND_TILT_DEGREES = 30.0
    const val HAND_TILT_SECONDS = 2L
    const val MAX_STEP_SECONDS = 2.5
    private const val MAX_PHONE_USE_FIX_GAP_MILLIS = 30_000L
    private const val AXIS_EVIDENCE_ACCELERATION = 1.5
    private const val MIN_AXIS_EVIDENCE = 1.0
    private const val BASELINE_SECONDS = 5L
    private const val HAND_BASELINE_SECONDS = 3L
    private const val BASELINE_MILLIS = 10_000L
    private const val MAX_DURATION_SECONDS = 65_535.0
    private val RANK_ORDER = listOf(DrivingEventType.PHONE_USE, DrivingEventType.SPEEDING, DrivingEventType.HARD_BRAKING, DrivingEventType.RAPID_ACCELERATION)

    fun severity(event: DrivingEvent): Double =
      when (event.type) {
        DrivingEventType.HARD_BRAKING, DrivingEventType.RAPID_ACCELERATION -> event.peak
        DrivingEventType.PHONE_USE -> event.durationSeconds
        DrivingEventType.SPEEDING -> event.limit?.speed?.takeIf { it > 0 }?.let { (event.peak - it) / it * event.durationSeconds } ?: 0.0
      }

    fun mostSevereFirst(events: List<DrivingEvent>): List<DrivingEvent> {
      val byType =
        RANK_ORDER.map { type ->
          events
            .filter { it.type == type }
            .sortedWith(compareByDescending<DrivingEvent> { severity(it) }.thenByDescending { it.peak }.thenBy { it.timeOffsetSeconds })
        }
      return (0 until (byType.maxOfOrNull { it.size } ?: 0)).flatMap { rank -> byType.mapNotNull { it.getOrNull(rank) } }
    }
  }
}
