package expo.modules.openbeacontracking

import android.content.Context
import android.provider.Settings
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.capture.CaptureCommandState
import expo.modules.openbeacontracking.capture.SharingCaptureState
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
    return SharingCaptureState(
      revisionPrefix = preferences.getString("$owner.prefix", "") ?: "",
      paused = preferences.getBoolean("$owner.paused", false),
      pausedUntil = preferences.getLong("$owner.until", 0L).takeIf { it > 0L },
      resumeAfter = preferences.getLong("$owner.after", 0L),
    )
  }

  fun setSharingState(context: Context, state: SharingCaptureState) {
    val owner = queueOwner(context) ?: return
    val preferences = context.getSharedPreferences("openbeacon_tracking_sharing", Context.MODE_PRIVATE)
    check(preferences.edit()
      .putString("$owner.prefix", state.revisionPrefix)
      .putBoolean("$owner.paused", state.paused)
      .putLong("$owner.until", state.pausedUntil ?: 0L)
      .putLong("$owner.after", state.resumeAfter)
      .commit())
  }

  fun queueOwner(context: Context): String? =
    context.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).getString("owner", null)

  fun isCaptureEnabled(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("enabled", false)

  fun setCaptureEnabled(
    context: Context,
    enabled: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).commit())
  }
}
