package expo.modules.openbeacontracking.crypto

import java.nio.ByteBuffer

object TrackingPointCodec {
  const val VERSION = 2
  const val LENGTH = 23
  private const val UNKNOWN_UINT16 = 0xFFFF
  private const val UNKNOWN_BATTERY_LEVEL = 127
  private const val STAY_FLAG = 1
  private const val DRIVE_DETECTION_OFF_FLAG = 2
  private const val CRASH_ALERTS_OFF_FLAG = 4
  private const val DRIVE_ALERTS_OFF_FLAG = 8
  private const val MAX_TIME_MILLIS = (1L shl 48) - 1

  fun encode(
    latitude: Double,
    longitude: Double,
    timestampMillis: Long,
    stayUntilMillis: Long?,
    accuracyMeters: Double?,
    speedMetersPerSecond: Double?,
    batteryLevel: Int?,
    batteryCharging: Boolean,
    driveDetectionOff: Boolean = false,
    crashAlertsOff: Boolean = false,
    driveAlertsOff: Boolean = false,
  ): ByteArray? {
    if (!latitude.isFinite() || latitude < -90.0 || latitude > 90.0) return null
    if (!longitude.isFinite() || longitude < -180.0 || longitude > 180.0) return null
    if (timestampMillis < 0 || timestampMillis > MAX_TIME_MILLIS) return null

    val stayMinutes = stayUntilMillis?.let { ((it - timestampMillis).coerceAtLeast(0) / 60_000L).coerceAtMost(UNKNOWN_UINT16.toLong()).toInt() } ?: 0
    val level = batteryLevel?.coerceIn(0, 100) ?: UNKNOWN_BATTERY_LEVEL

    return ByteBuffer
      .allocate(LENGTH)
      .put(VERSION.toByte())
      .putInt(Math.round(latitude * 1e7).toInt())
      .putInt(Math.round(longitude * 1e7).toInt())
      .putShort((timestampMillis ushr 32).toInt().toShort())
      .putInt(timestampMillis.toInt())
      .putShort(stayMinutes.toShort())
      .putShort(encodeUint16(accuracyMeters, 10.0).toShort())
      .putShort(encodeUint16(speedMetersPerSecond, 100.0).toShort())
      .put(((if (batteryCharging) 0x80 else 0) or level).toByte())
      .put(
        (
          (if (stayUntilMillis == null) 0 else STAY_FLAG) or
            (if (driveDetectionOff) DRIVE_DETECTION_OFF_FLAG else 0) or
            (if (crashAlertsOff) CRASH_ALERTS_OFF_FLAG else 0) or
            (if (driveAlertsOff) DRIVE_ALERTS_OFF_FLAG else 0)
        ).toByte(),
      )
      .array()
  }

  private fun encodeUint16(
    value: Double?,
    scale: Double,
  ): Int {
    if (value == null || !value.isFinite() || value < 0.0) return UNKNOWN_UINT16
    return Math.round(value * scale).coerceAtMost(UNKNOWN_UINT16 - 1L).toInt()
  }
}
