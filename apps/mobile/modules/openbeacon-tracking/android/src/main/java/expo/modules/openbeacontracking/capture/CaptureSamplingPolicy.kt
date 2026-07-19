package expo.modules.openbeacontracking.capture

data class CaptureSamplingDecision(
  val shouldQueue: Boolean,
  val intervalMs: Long,
)

object CaptureSamplingPolicy {
  const val DEFAULT_INTERVAL_MS = 30_000L
  const val MOVING_INTERVAL_MS = 10_000L
  const val BATTERY_SAVER_DEFAULT_INTERVAL_MS = 60_000L
  const val BATTERY_SAVER_MOVING_INTERVAL_MS = 20_000L
  const val MOVING_SPEED_MPS = 1.0
  const val STATIONARY_DISTANCE_METERS = 25.0
  const val MAX_STATIONARY_SKIP_MS = 300_000L
  const val LOW_BATTERY_LEVEL = 15

  fun evaluate(
    powerSaveMode: Boolean,
    batteryLevel: Int,
    batteryLevelKnown: Boolean,
    charging: Boolean,
    speedMetersPerSecond: Double?,
    distanceFromLastQueuedMeters: Double?,
    timeSinceLastQueuedMs: Long?,
  ): CaptureSamplingDecision {
    val batterySaver =
      isBatterySaver(
        powerSaveMode = powerSaveMode,
        batteryLevel = batteryLevel,
        batteryLevelKnown = batteryLevelKnown,
        charging = charging,
      )
    val moving = isMoving(speedMetersPerSecond)
    val intervalMs =
      when {
        batterySaver && moving -> BATTERY_SAVER_MOVING_INTERVAL_MS
        batterySaver -> BATTERY_SAVER_DEFAULT_INTERVAL_MS
        moving -> MOVING_INTERVAL_MS
        else -> DEFAULT_INTERVAL_MS
      }

    return CaptureSamplingDecision(
      shouldQueue =
        shouldQueue(
          moving = moving,
          distanceFromLastQueuedMeters = distanceFromLastQueuedMeters,
          timeSinceLastQueuedMs = timeSinceLastQueuedMs,
        ),
      intervalMs = intervalMs,
    )
  }

  private fun isBatterySaver(
    powerSaveMode: Boolean,
    batteryLevel: Int,
    batteryLevelKnown: Boolean,
    charging: Boolean,
  ): Boolean =
    powerSaveMode ||
      (batteryLevelKnown && batteryLevel <= LOW_BATTERY_LEVEL && !charging)

  private fun isMoving(speedMetersPerSecond: Double?): Boolean =
    speedMetersPerSecond != null && speedMetersPerSecond >= MOVING_SPEED_MPS

  private fun shouldQueue(
    moving: Boolean,
    distanceFromLastQueuedMeters: Double?,
    timeSinceLastQueuedMs: Long?,
  ): Boolean {
    if (distanceFromLastQueuedMeters == null || timeSinceLastQueuedMs == null) {
      return true
    }
    if (timeSinceLastQueuedMs >= MAX_STATIONARY_SKIP_MS) {
      return true
    }
    if (moving) {
      return true
    }
    return distanceFromLastQueuedMeters >= STATIONARY_DISTANCE_METERS
  }
}
