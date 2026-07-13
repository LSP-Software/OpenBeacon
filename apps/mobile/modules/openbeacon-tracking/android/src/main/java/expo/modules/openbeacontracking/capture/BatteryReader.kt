package expo.modules.openbeacontracking.capture

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

data class BatterySnapshot(
  val level: Int,
  val charging: Boolean,
)

object BatteryReader {
  fun read(context: Context): BatterySnapshot {
    val batteryStatus =
      context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        ?: return BatterySnapshot(level = 0, charging = false)

    val level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    val percent =
      if (level >= 0 && scale > 0) {
        ((level.toFloat() / scale.toFloat()) * 100f).toInt().coerceIn(0, 100)
      } else {
        0
      }

    val status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val charging =
      status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL

    return BatterySnapshot(level = percent, charging = charging)
  }
}
