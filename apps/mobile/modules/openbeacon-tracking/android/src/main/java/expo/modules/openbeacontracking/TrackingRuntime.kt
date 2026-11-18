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
import expo.modules.openbeacontracking.capture.CaptureHistoryShare
import expo.modules.openbeacontracking.capture.SharingCaptureState
import expo.modules.openbeacontracking.capture.SeatHoldNotice
import expo.modules.openbeacontracking.capture.HistoryAllowance
import expo.modules.openbeacontracking.capture.BootRestartPolicy
import expo.modules.openbeacontracking.capture.SharingResumeWorker
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.keys.CachedEpochKeyStore
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.keys.SecureEpochKeyStore
import expo.modules.openbeacontracking.places.PlaceDetection
import expo.modules.openbeacontracking.places.PlaceTransitionDatabase
import expo.modules.openbeacontracking.places.RoomPlaceTransitionQueue
import expo.modules.openbeacontracking.places.SecurePlaceStore
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
  private var placeDetection: PlaceDetection? = null

  @Volatile
  var isCaptureRunning: Boolean = false

  fun epochKeyStore(context: Context): EpochKeyStore {
    epochKeyStore?.let {
      return it
    }

    return synchronized(this) {
      epochKeyStore
        ?: CachedEpochKeyStore(SecureEpochKeyStore(context.applicationContext)).also { epochKeyStore = it }
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

  fun placeDetection(context: Context): PlaceDetection {
    placeDetection?.let {
      return it
    }

    return synchronized(this) {
      placeDetection
        ?: PlaceDetection(
          store = SecurePlaceStore(context.applicationContext),
          queue = RoomPlaceTransitionQueue(PlaceTransitionDatabase.getInstance(context.applicationContext)),
        ).also { placeDetection = it }
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
      historyShare = { historyShare(context) },
      loadAllowance = { group ->
        val parts = context.getSharedPreferences("openbeacon_tracking_history_allowance", Context.MODE_PRIVATE)
          .getString(org.json.JSONArray(group).toString(), null)
          ?.split(":")
        val tokens = parts?.getOrNull(0)?.toDoubleOrNull()?.takeIf { it.isFinite() }
        val updatedAt = parts?.getOrNull(1)?.toLongOrNull()
        if (parts?.size == 2 && tokens != null && updatedAt != null) HistoryAllowance(tokens, updatedAt) else null
      },
      saveAllowance = { group, allowance ->
        context.getSharedPreferences("openbeacon_tracking_history_allowance", Context.MODE_PRIVATE)
          .edit()
          .putString(org.json.JSONArray(group).toString(), "${allowance.tokens}:${allowance.updatedAt}")
          .apply()
      },
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
    val previous = SharingCaptureState.confirmedRevision(preferences.getString("$scope.confirmed", null), sharingState(context))
    check(preferences.edit()
      .putString("$scope.prefix", state.revisionPrefix)
      .putBoolean("$scope.paused", state.paused)
      .putLong("$scope.until", state.pausedUntil ?: 0L)
      .putLong("$scope.after", state.resumeAfter)
      .putString("$scope.confirmed", state.confirmedRevision(replacing = previous))
      .commit())
  }

  fun seatHoldNotice(context: Context): SeatHoldNotice {
    val owner = queueOwner(context) ?: return SeatHoldNotice()
    val deviceId = queueDeviceId(context) ?: return SeatHoldNotice()
    val stored = context.getSharedPreferences("openbeacon_tracking_seat_holds", Context.MODE_PRIVATE)
      .getString(org.json.JSONArray(listOf(owner, deviceId)).toString(), null) ?: return SeatHoldNotice()
    val notice = org.json.JSONObject(stored)
    val names = { key: String -> notice.getJSONArray(key).let { list -> (0 until list.length()).map(list::getString) } }
    return SeatHoldNotice(sharing = names("sharing"), held = names("held"))
  }

  fun setSeatHoldNotice(context: Context, owner: String, deviceId: String, notice: SeatHoldNotice): Boolean {
    val changed = synchronized(captureLock) {
      if (queueOwner(context) != owner || queueDeviceId(context) != deviceId) return false
      if (seatHoldNotice(context) == notice) return true
      val stored = org.json.JSONObject()
        .put("sharing", org.json.JSONArray(notice.sharing))
        .put("held", org.json.JSONArray(notice.held))
      check(context.getSharedPreferences("openbeacon_tracking_seat_holds", Context.MODE_PRIVATE)
        .edit()
        .putString(org.json.JSONArray(listOf(owner, deviceId)).toString(), stored.toString())
        .commit())
      true
    }
    if (changed && isCaptureRunning) {
      try {
        context.startService(Intent(context, TrackingCaptureService::class.java).apply {
          action = TrackingCaptureService.ACTION_NOTICE_CHANGED
        })
      } catch (error: IllegalStateException) {
        Log.e("TrackingRuntime", "Failed to update the location sharing notice.", error)
      }
    }
    return true
  }

  fun historyShare(context: Context): CaptureHistoryShare {
    val owner = queueOwner(context) ?: return CaptureHistoryShare()
    val deviceId = queueDeviceId(context) ?: return CaptureHistoryShare()
    val stored = context.getSharedPreferences("openbeacon_tracking_history_share", Context.MODE_PRIVATE)
      .getString(org.json.JSONArray(listOf(owner, deviceId)).toString(), null) ?: return CaptureHistoryShare()
    val setting = org.json.JSONObject(stored)
    val groups = setting.getJSONObject("groups")
    return CaptureHistoryShare(
      account = setting.getString("account"),
      groups = groups.keys().asSequence().associateWith { groups.getString(it) },
    )
  }

  fun setHistoryShare(context: Context, owner: String, deviceId: String, account: String, groups: Map<String, String>): Boolean =
    synchronized(captureLock) {
      if (queueOwner(context) != owner || queueDeviceId(context) != deviceId) return false
      val setting = org.json.JSONObject().put("account", account).put("groups", org.json.JSONObject(groups))
      check(context.getSharedPreferences("openbeacon_tracking_history_share", Context.MODE_PRIVATE)
        .edit()
        .putString(org.json.JSONArray(listOf(owner, deviceId)).toString(), setting.toString())
        .commit())
      true
    }

  private fun confirmedRevision(context: Context): String {
    val owner = queueOwner(context) ?: return ""
    val deviceId = queueDeviceId(context) ?: return ""
    val scope = org.json.JSONArray(listOf(owner, deviceId)).toString()
    val preferences = context.getSharedPreferences("openbeacon_tracking_sharing", Context.MODE_PRIVATE)
    return SharingCaptureState.confirmedRevision(preferences.getString("$scope.confirmed", null), sharingState(context))
  }

  fun applySharingState(context: Context, owner: String, deviceId: String, state: SharingCaptureState): Boolean {
    val changed = synchronized(captureLock) {
      if (queueOwner(context) != owner || queueDeviceId(context) != deviceId) return false
      val current = sharingState(context)
      if (!state.canReplace(current, confirmedRevision(context))) return false
      val changed = current != state
      if (changed) {
        captureCommands.stop()
        setSharingState(context, state)
        placeDetection(context).onSharingChanged(owner, state, System.currentTimeMillis())
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
        placeDetection(context).removeGroups(null)
      }
      if (previousOwner != null && previousOwner != owner) clearHistoryAllowance(context, previousOwner)
      if (previousOwner != owner || previousDeviceId != deviceId) {
        check(preferences.edit().putString("owner", owner).putString("deviceId", deviceId).commit())
      }
    }
  }

  fun clearHistoryAllowance(context: Context, owner: String) {
    val preferences = context.getSharedPreferences("openbeacon_tracking_history_allowance", Context.MODE_PRIVATE)
    val ownerPrefix = org.json.JSONArray(listOf(owner)).toString().removeSuffix("]") + ","
    val editor = preferences.edit()
    preferences.all.keys.filter { it.startsWith(ownerPrefix) }.forEach { editor.remove(it) }
    editor.apply()
  }

  fun isCaptureEnabled(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("enabled", false)

  fun isCaptureParked(context: Context): Boolean =
    isCaptureEnabled(context) && sharingState(context).isConfirmedIndefinitePause()

  fun shouldRestoreCapture(context: Context): Boolean =
    BootRestartPolicy.shouldRestart(
      captureEnabled = isCaptureEnabled(context),
      hasQueueOwner = queueOwner(context) != null,
      hasEpochKeys = epochKeyStore(context).list().isNotEmpty(),
      hasLocationPermission = hasLocationPermission(context),
      hasBackgroundLocationPermission = hasBackgroundLocationPermission(context),
    )

  fun hasLostLocationPermission(context: Context): Boolean =
    isCaptureEnabled(context) &&
      queueOwner(context) != null &&
      epochKeyStore(context).list().isNotEmpty() &&
      !(hasLocationPermission(context) && hasBackgroundLocationPermission(context))

  private fun hasLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun hasBackgroundLocationPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

  fun setCaptureEnabled(
    context: Context,
    enabled: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).commit())
    if (!enabled) {
      SharingResumeWorker.cancel(context)
      Notices.dismiss(context, NoticeSlot.LOCATION_PERMISSION)
      Notices.dismiss(context, NoticeSlot.SHARING_CHANGED)
    }
  }
}
