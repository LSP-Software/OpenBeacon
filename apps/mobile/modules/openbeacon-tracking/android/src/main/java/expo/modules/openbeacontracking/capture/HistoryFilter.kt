package expo.modules.openbeacontracking.capture

import kotlin.math.max
import kotlin.math.min

data class HistoryFilterSettings(
  val minToleranceMeters: Double = 15.0,
  val toleranceSecondsOfSpeed: Double = 1.5,
  val maxGapMeters: Double = 600.0,
  val shortestMaxGapMs: Long = 30_000L,
  val longestMaxGapMs: Long = 120_000L,
  val stayRadiusMeters: Double = 50.0,
  val stayAfterMs: Long = 180_000L,
  val stayUpdateMs: Long = 300_000L,
  val stayGapMs: Long = 600_000L,
  val maxAccuracyMeters: Double = 200.0,
  val dailyAllowance: Int = 2_880,
  val allowanceWindowMs: Long = 86_400_000L,
)

data class HistoryFix(
  val latitude: Double,
  val longitude: Double,
  val timestampMillis: Long,
  val accuracyMeters: Double?,
  val speedMetersPerSecond: Double?,
  val batteryLevel: Int?,
  val batteryCharging: Boolean,
  val fixId: Long?,
)

data class HistoryRecord(
  val fix: HistoryFix,
  val stayUntil: Long? = null,
)

data class HistoryAllowance(
  val tokens: Double,
  val updatedAt: Long,
) {
  fun refill(
    now: Long,
    settings: HistoryFilterSettings,
  ): HistoryAllowance {
    val limit = settings.dailyAllowance.toDouble()
    return HistoryAllowance(min(limit, tokens + max(0L, now - updatedAt) * limit / settings.allowanceWindowMs), now)
  }

  fun take(
    now: Long,
    settings: HistoryFilterSettings,
  ): HistoryAllowance? {
    val refilled = refill(now, settings)
    return if (refilled.tokens >= 1.0) refilled.copy(tokens = refilled.tokens - 1.0) else null
  }

  companion object {
    fun full(
      now: Long,
      settings: HistoryFilterSettings,
    ) = HistoryAllowance(settings.dailyAllowance.toDouble(), now)
  }
}

class HistoryFilter(
  private val settings: HistoryFilterSettings = HistoryFilterSettings(),
) {
  private data class Stay(
    val arrival: HistoryFix?,
    val latest: HistoryFix,
    val latitudeSum: Double,
    val longitudeSum: Double,
    val count: Int,
    val sentUntil: Long?,
  ) {
    val latitude get() = latitudeSum / count
    val longitude get() = longitudeSum / count

    fun record() =
      arrival?.let {
        HistoryRecord(
          fix = it.copy(
            latitude = latitude,
            longitude = longitude,
            batteryLevel = latest.batteryLevel,
            batteryCharging = latest.batteryCharging,
          ),
          stayUntil = latest.timestampMillis,
        )
      }
  }

  private var lastTimestamp = Long.MIN_VALUE
  private var lastKept: HistoryFix? = null
  private val pending = mutableListOf<HistoryFix>()
  private val still = mutableListOf<HistoryFix>()
  private var stay: Stay? = null
  private var leaving: HistoryFix? = null

  fun onFix(
    fix: HistoryFix,
    takeAllowance: () -> Boolean,
  ): List<HistoryRecord> {
    if (fix.accuracyMeters != null && fix.accuracyMeters > settings.maxAccuracyMeters) return emptyList()
    if (fix.timestampMillis <= lastTimestamp) {
      if (lastTimestamp - fix.timestampMillis <= settings.stayGapMs) return emptyList()
      stay = null
      leaving = null
      lastKept = null
      pending.clear()
      still.clear()
    }
    lastTimestamp = fix.timestampMillis

    val current = stay ?: return onMovingFix(fix, takeAllowance)
    val distance = PlaceDwellDetector.distanceMeters(current.latitude, current.longitude, fix.latitude, fix.longitude)
    val gap = fix.timestampMillis - current.latest.timestampMillis > settings.stayGapMs
    if (!gap && distance - (fix.accuracyMeters ?: 0.0) <= settings.stayRadiusMeters) {
      leaving = null
      val arrival = current.arrival ?: fix
      val next = current.copy(
        arrival = arrival,
        latest = fix,
        latitudeSum = current.latitudeSum + fix.latitude,
        longitudeSum = current.longitudeSum + fix.longitude,
        count = current.count + 1,
      )
      val due = current.arrival == null || fix.timestampMillis - (next.sentUntil ?: arrival.timestampMillis) >= settings.stayUpdateMs
      if (due && takeAllowance()) {
        stay = next.copy(sentUntil = fix.timestampMillis)
        return listOfNotNull(next.record())
      }
      stay = next
      return emptyList()
    }
    val firstOutside = leaving
    if (!gap && firstOutside == null) {
      leaving = fix
      return emptyList()
    }
    val records = close(current, takeAllowance)
    stay = null
    leaving = null
    lastKept = if (gap) null else current.latest.copy(latitude = current.latitude, longitude = current.longitude)
    pending.clear()
    still.clear()
    val departure = if (gap || firstOutside == null) emptyList() else onMovingFix(firstOutside, takeAllowance)
    return records + departure + onMovingFix(fix, takeAllowance)
  }

  private fun onMovingFix(
    fix: HistoryFix,
    takeAllowance: () -> Boolean,
  ): List<HistoryRecord> {
    val records = keepRoute(fix, takeAllowance)
    val anchor = still.firstOrNull()
    if (anchor != null && (fix.timestampMillis - still.last().timestampMillis > settings.stayGapMs || PlaceDwellDetector.distanceMeters(anchor.latitude, anchor.longitude, fix.latitude, fix.longitude) - (fix.accuracyMeters ?: 0.0) > settings.stayRadiusMeters)) {
      still.clear()
    }
    still.add(fix)
    if (fix.timestampMillis - still.first().timestampMillis < settings.stayAfterMs) return records

    val arrived = Stay(
      arrival = still.first(),
      latest = fix,
      latitudeSum = still.sumOf { it.latitude },
      longitudeSum = still.sumOf { it.longitude },
      count = still.size,
      sentUntil = null,
    )
    still.clear()
    pending.clear()
    lastKept = null
    if (!takeAllowance()) {
      stay = arrived
      return records
    }
    stay = arrived.copy(sentUntil = fix.timestampMillis)
    return records + listOfNotNull(arrived.record())
  }

  fun handOver(takeAllowance: () -> Boolean): Pair<HistoryFilter, List<HistoryRecord>> {
    val current = stay
    val next = HistoryFilter(settings)
    next.lastTimestamp = lastTimestamp
    next.lastKept = lastKept
    next.stay = current?.copy(arrival = null, sentUntil = null)
    return next to if (current == null) emptyList() else close(current, takeAllowance)
  }

  private fun close(
    current: Stay,
    takeAllowance: () -> Boolean,
  ): List<HistoryRecord> {
    val record = current.record() ?: return emptyList()
    return if (current.sentUntil != current.latest.timestampMillis && takeAllowance()) listOf(record) else emptyList()
  }

  private fun keepRoute(
    fix: HistoryFix,
    takeAllowance: () -> Boolean,
  ): List<HistoryRecord> {
    val kept = lastKept
    if (kept == null) {
      if (!takeAllowance()) return emptyList()
      lastKept = fix
      pending.clear()
      return listOf(HistoryRecord(fix))
    }
    val records = mutableListOf<HistoryRecord>()
    val previous = pending.lastOrNull()
    val start =
      if (previous != null && pending.any { routeError(kept, fix, it) > tolerance(it) }) {
        if (!takeAllowance()) {
          dropRoute()
          return emptyList()
        }
        records.add(HistoryRecord(previous))
        lastKept = previous
        pending.clear()
        previous
      } else {
        kept
      }
    if (fix.timestampMillis - start.timestampMillis < maxGapMs(fix)) {
      pending.add(fix)
      return records
    }
    if (!takeAllowance()) {
      dropRoute()
      return records
    }
    lastKept = fix
    pending.clear()
    return records + HistoryRecord(fix)
  }

  private fun dropRoute() {
    lastKept = null
    pending.clear()
  }

  private fun routeError(
    from: HistoryFix,
    to: HistoryFix,
    actual: HistoryFix,
  ): Double {
    val fraction = (actual.timestampMillis - from.timestampMillis).toDouble() / (to.timestampMillis - from.timestampMillis)
    return PlaceDwellDetector.distanceMeters(
      from.latitude + (to.latitude - from.latitude) * fraction,
      from.longitude + (to.longitude - from.longitude) * fraction,
      actual.latitude,
      actual.longitude,
    )
  }

  private fun tolerance(fix: HistoryFix): Double =
    max(settings.minToleranceMeters, settings.toleranceSecondsOfSpeed * (fix.speedMetersPerSecond ?: 0.0))

  private fun maxGapMs(fix: HistoryFix): Long {
    val speed = fix.speedMetersPerSecond?.takeIf { it > 0.0 } ?: return settings.longestMaxGapMs
    return (settings.maxGapMeters / speed * 1_000).toLong().coerceIn(settings.shortestMaxGapMs, settings.longestMaxGapMs)
  }
}
