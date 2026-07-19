package expo.modules.openbeacontracking.capture

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager

object BatteryReader {
  fun read(context: Context): BatterySnapshot {
    val powerSaveMode =
      (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isPowerSaveMode == true

    val batteryStatus =
      context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        ?: return BatterySnapshot(
          level = 0,
          charging = false,
          powerSaveMode = powerSaveMode,
          levelKnown = false,
        )

    val level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    val levelKnown = level >= 0 && scale > 0
    val percent =
      if (levelKnown) {
        ((level.toFloat() / scale.toFloat()) * 100f).toInt().coerceIn(0, 100)
      } else {
        0
      }

    val status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val charging =
      status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL

    return BatterySnapshot(
      level = percent,
      charging = charging,
      powerSaveMode = powerSaveMode,
      levelKnown = levelKnown,
    )
  }
}
