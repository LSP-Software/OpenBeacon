package expo.modules.openbeacontracking.crash

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CrashCountdownReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    when (intent.action) {
      ACTION_IM_OK -> CrashCountdownController.imOk(context)
      ACTION_SEND_NOW -> CrashCountdownController.sendNow(context)
    }
  }

  companion object {
    const val ACTION_IM_OK = "expo.modules.openbeacontracking.crash.IM_OK"
    const val ACTION_SEND_NOW = "expo.modules.openbeacontracking.crash.SEND_NOW"

    fun intent(
      context: Context,
      action: String,
    ): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        action.hashCode(),
        Intent(context, CrashCountdownReceiver::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
  }
}
