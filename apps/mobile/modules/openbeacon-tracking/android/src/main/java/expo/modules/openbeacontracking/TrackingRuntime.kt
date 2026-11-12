package expo.modules.openbeacontracking

import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.capture.CaptureCommandState
import expo.modules.openbeacontracking.capture.SharingCaptureState
import expo.modules.openbeacontracking.capture.BootRestartPolicy
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.keys.SecureEpochKeyStore
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.openbeacontracking.queue.RoomCiphertextQueue

object TrackingRuntime {
  val captureLock = Any()
  val captureCommands = CaptureCommandState()
  @Volatile
  private var epochKeyStore: EpochKeyStore? = null

  @Volatile
  private var ciphertextQueue: RoomCiphertextQueue? = null

  @Volatile
  var isCaptureRunning: Boolean = false

  fun epochKeyStore(context: Context): EpochKeyStore {
    epochKeyStore?.let {
      return it
    }

    return synchronized(this) {
      epochKeyStore
        ?: SecureEpochKeyStore(context.applicationContext).also { epochKeyStore = it }
    }
  }

  fun ciphertextQueue(context: Context): RoomCiphertextQueue {
    ciphertextQueue?.let {
      return it
    }

    return synchronized(this) {
      ciphertextQueue
        ?: RoomCiphertextQueue(CiphertextQueueDatabase.getInstance(context.applicationContext)).also { ciphertextQueue = it }
    }
  }

  fun capturePipeline(context: Context): CapturePipeline =
    CapturePipeline(
      epochKeyStore = epochKeyStore(context),
      ciphertextQueue = ciphertextQueue(context),
      captureLock = captureLock,
      canQueue = { generation -> isCaptureRunning && captureCommands.isCurrent(generation) },
      queueOwner = { queueOwner(context) },
      bootId = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1).takeIf { it >= 0 }?.toString(),
      sharingState = { sharingState(context) },
    )

  fun sharingState(context: Context): SharingCaptureState {
    val preferences = context.getSharedPreferences("openbeacon_tracking_sharing", Context.MODE_PRIVATE)
    val owner = queueOwner(context) ?: return SharingCaptureState(paused = true)
    val deviceId = queueDeviceId(context) ?: return SharingCaptureState(paused = true)
    val scope = org.json.JSONArray(listOf(owner, deviceId)).toString()
    return SharingCaptureState(
      revisionPrefix = preferences.getString("$scope.prefix", "") ?: "",
      paused = preferences.getBoolean("$scope.paused", true),
      pausedUntil = preferences.getLong("$scope.until", 0L).takeIf { it > 0L },
      resumeAfter = preferences.getLong("$scope.after", 0L),
    )
  }

  fun setSharingState(context: Context, state: SharingCaptureState) {
    val owner = queueOwner(context) ?: return
    val deviceId = queueDeviceId(context) ?: return
    val scope = org.json.JSONArray(listOf(owner, deviceId)).toString()
    val preferences = context.getSharedPreferences("openbeacon_tracking_sharing", Context.MODE_PRIVATE)
    check(preferences.edit()
      .putString("$scope.prefix", state.revisionPrefix)
      .putBoolean("$scope.paused", state.paused)
      .putLong("$scope.until", state.pausedUntil ?: 0L)
      .putLong("$scope.after", state.resumeAfter)
      .commit())
  }

  fun applySharingState(context: Context, owner: String, deviceId: String, state: SharingCaptureState): Boolean {
    val changed = synchronized(captureLock) {
      if (queueOwner(context) != owner || queueDeviceId(context) != deviceId) return false
      val current = sharingState(context)
      if (!(state.revisionPrefix.isEmpty() && state.paused) && !state.isAtLeastAsRecentAs(current)) return false
      val changed = current != state
      if (changed) {
        captureCommands.stop()
        setSharingState(context, state)
      }
      changed
    }
    if (changed && isCaptureRunning) {
      try {
        context.startService(Intent(context, TrackingCaptureService::class.java).apply {
          action = TrackingCaptureService.ACTION_SHARING_CHANGED
        })
      } catch (error: IllegalStateException) {
        Log.e("TrackingRuntime", "Failed to deliver the location sharing change to capture.", error)
      }
    }
    return true
  }

  fun queueOwner(context: Context): String? =
    context.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).getString("owner", null)

  fun queueDeviceId(context: Context): String? =
    context.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).getString("deviceId", null)

  fun setQueueOwner(context: Context, owner: String, deviceId: String) {
    synchronized(captureLock) {
      val preferences = context.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE)
      val previousOwner = preferences.getString("owner", null)
      val previousDeviceId = preferences.getString("deviceId", null)
      if (previousOwner != owner || (previousDeviceId != null && previousDeviceId != deviceId)) {
        captureCommands.stop()
        isCaptureRunning = false
        setCaptureEnabled(context, false)
        context.stopService(Intent(context, TrackingCaptureService::class.java))
        epochKeyStore(context).revoke(null)
      }
      if (previousOwner != owner || previousDeviceId != deviceId) {
        check(preferences.edit().putString("owner", owner).putString("deviceId", deviceId).commit())
      }
    }
  }

  fun isCaptureEnabled(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("enabled", false)

  fun shouldRestoreCapture(context: Context): Boolean =
    BootRestartPolicy.shouldRestart(
      captureEnabled = isCaptureEnabled(context),
      hasQueueOwner = queueOwner(context) != null,
      hasEpochKeys = epochKeyStore(context).list().isNotEmpty(),
      hasLocationPermission =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
          ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED,
      hasBackgroundLocationPermission =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
          ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED,
    )

  fun setCaptureEnabled(
    context: Context,
    enabled: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).commit())
  }
}
