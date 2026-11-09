package expo.modules.openbeacontracking.capture

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
        BootRestartPolicy.shouldRestart(
          captureEnabled = TrackingRuntime.isCaptureEnabled(context),
          hasQueueOwner = TrackingRuntime.queueOwner(context) != null,
          hasEpochKeys = TrackingRuntime.epochKeyStore(context).list().isNotEmpty(),
          hasLocationPermission =
            context.isGranted(Manifest.permission.ACCESS_FINE_LOCATION) ||
              context.isGranted(Manifest.permission.ACCESS_COARSE_LOCATION),
          hasBackgroundLocationPermission =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
              context.isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
        )
      }
    if (!shouldRestart) return

    try {
      ContextCompat.startForegroundService(context, Intent(context, TrackingCaptureService::class.java))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to restart location capture after ${intent.action}.", error)
    }
  }

  private fun Context.isGranted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  companion object {
    private const val TAG = "TrackingBoot"
  }
}
