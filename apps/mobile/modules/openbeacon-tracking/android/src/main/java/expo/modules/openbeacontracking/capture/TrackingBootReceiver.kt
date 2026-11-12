package expo.modules.openbeacontracking.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.TrackingRuntime

class TrackingBootReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    val shouldRestart =
      synchronized(TrackingRuntime.captureLock) {
        TrackingRuntime.shouldRestoreCapture(context)
      }
    if (!shouldRestart) return
    if (TrackingRuntime.isCaptureParked(context)) {
      SharingResumeWorker.schedule(context)
      return
    }

    try {
      ContextCompat.startForegroundService(context, Intent(context, TrackingCaptureService::class.java))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to restart location capture after ${intent.action}.", error)
    }
  }

  companion object {
    private const val TAG = "TrackingBoot"
  }
}
