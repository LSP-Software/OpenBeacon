package expo.modules.openbeacontracking.capture

data class CaptureSamplingDecision(
  val shouldQueue: Boolean,
  val intervalMs: Long,
  val forceUpload: Boolean,
  val uploadIntervalMs: Long,
)

object CaptureSamplingPolicy {
  const val DEFAULT_INTERVAL_MS = 30_000L
  const val MOVING_INTERVAL_MS = 10_000L
  const val BATTERY_SAVER_DEFAULT_INTERVAL_MS = 60_000L
  const val BATTERY_SAVER_MOVING_INTERVAL_MS = 20_000L
  const val UPLOAD_INTERVAL_MS = 60_000L
  const val BATTERY_SAVER_UPLOAD_INTERVAL_MS = 120_000L
  const val FASTEST_UPLOAD_INTERVAL_MS = 10_000L
  const val MAX_DISTANCE_BETWEEN_UPLOADS_METERS = 100.0
  const val NEAREST_FIX_SLACK_MS = MOVING_INTERVAL_MS / 2
  const val MOVING_SPEED_MPS = 0.5
  const val MAX_SPEED_ACCURACY_METERS = 20.0
  const val STATIONARY_DISTANCE_METERS = 25.0
  const val MAX_STATIONARY_SKIP_MS = 300_000L
  const val LOW_BATTERY_LEVEL = 15

  fun evaluate(
    battery: BatterySnapshot,
    speedMetersPerSecond: Double?,
    accuracyMeters: Double?,
    distanceFromLastQueuedMeters: Double?,
    timeSinceLastQueuedMs: Long?,
    forcedRefresh: Boolean = false,
    lowPowerMode: Boolean = false,
    confirmingPlace: Boolean = false,
  ): CaptureSamplingDecision {
    val batterySaver = isBatterySaver(battery)
    val trustedSpeed = if (accuracyMeters != null && accuracyMeters <= MAX_SPEED_ACCURACY_METERS) speedMetersPerSecond else null
    val coveredMeters = distanceFromLastQueuedMeters?.let { it - (accuracyMeters ?: 0.0) }
    val moving =
      if (trustedSpeed != null) {
        trustedSpeed >= MOVING_SPEED_MPS
      } else {
        coveredMeters != null &&
          timeSinceLastQueuedMs != null &&
          coveredMeters >= STATIONARY_DISTANCE_METERS &&
          coveredMeters >= MOVING_SPEED_MPS * timeSinceLastQueuedMs / 1_000
      }
    val intervalMs =
      when {
        batterySaver && (moving || confirmingPlace) -> BATTERY_SAVER_MOVING_INTERVAL_MS
        batterySaver -> BATTERY_SAVER_DEFAULT_INTERVAL_MS
        moving || confirmingPlace -> MOVING_INTERVAL_MS
        else -> DEFAULT_INTERVAL_MS
      }

    return CaptureSamplingDecision(
      shouldQueue =
        forcedRefresh || shouldQueue(
          moving = moving,
          distanceFromLastQueuedMeters = distanceFromLastQueuedMeters,
          timeSinceLastQueuedMs = timeSinceLastQueuedMs,
        ),
      intervalMs = intervalMs,
      forceUpload = forcedRefresh,
      uploadIntervalMs =
        when {
          batterySaver -> BATTERY_SAVER_UPLOAD_INTERVAL_MS
          !moving -> UPLOAD_INTERVAL_MS
          lowPowerMode || trustedSpeed == null -> UPLOAD_INTERVAL_MS - NEAREST_FIX_SLACK_MS
          else ->
            (MAX_DISTANCE_BETWEEN_UPLOADS_METERS / trustedSpeed * 1_000)
              .toLong()
              .coerceIn(FASTEST_UPLOAD_INTERVAL_MS, UPLOAD_INTERVAL_MS) - NEAREST_FIX_SLACK_MS
        },
    )
  }

  private fun isBatterySaver(battery: BatterySnapshot): Boolean =
    battery.powerSaveMode ||
      (battery.levelKnown && battery.level <= LOW_BATTERY_LEVEL && !battery.charging)

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
