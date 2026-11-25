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
import expo.modules.openbeacontracking.crash.CrashCountdownController
import expo.modules.openbeacontracking.crash.CrashSensor
import expo.modules.openbeacontracking.crash.PrefsCrashAlertStore
import expo.modules.openbeacontracking.drives.CrashAlertOutbox
import expo.modules.openbeacontracking.drives.CrashDetector
import expo.modules.openbeacontracking.drives.DriveQueueDatabase
import expo.modules.openbeacontracking.drives.DriveRecordedNotice
import expo.modules.openbeacontracking.drives.DriveRecorder
import expo.modules.openbeacontracking.drives.SecureDriveLog
import expo.modules.openbeacontracking.drives.SecureDriveRecordStore
import expo.modules.openbeacontracking.drives.RoomDriveQueue
import expo.modules.openbeacontracking.drives.SpeedLimitPackStore
import expo.modules.openbeacontracking.drives.SpeedLimitPackWorker
import expo.modules.openbeacontracking.drives.SpeedingFinder
import java.io.File
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.openbeacontracking.queue.RoomCiphertextQueue
import java.util.TimeZone

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
  private var driveQueue: RoomDriveQueue? = null

  @Volatile
  private var driveRecorder: DriveRecorder? = null

  @Volatile
  private var speedLimitPackStore: SpeedLimitPackStore? = null

  @Volatile
  private var crashAlertOutbox: CrashAlertOutbox? = null

  @Volatile
  var isCaptureRunning: Boolean = false

  val crashDetector = CrashDetector()

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

  fun driveQueue(context: Context): RoomDriveQueue {
    driveQueue?.let {
      return it
    }

    return synchronized(this) {
      driveQueue ?: RoomDriveQueue(DriveQueueDatabase.getInstance(context.applicationContext)).also { driveQueue = it }
    }
  }

  fun driveRecorder(context: Context): DriveRecorder {
    driveRecorder?.let {
      return it
    }

    return synchronized(this) {
      driveRecorder
        ?: DriveRecorder(
          log = SecureDriveLog(context.applicationContext),
          records = SecureDriveRecordStore(context.applicationContext),
          queue = driveQueue(context),
          epochKeys = { epochKeyStore(context).list() },
          historyShare = { historyShare(context) },
          utcOffsetMinutes = { TimeZone.getDefault().getOffset(it) / 60_000 },
          findSpeeding = { fixes -> speedLimitPackStore(context).withPacks { SpeedingFinder.find(fixes, it) } },
          tellGroup = { groupId -> tellsGroup(context, groupId) },
          onFinished = { record, groupIds -> DriveRecordedNotice.show(context.applicationContext, record, groupIds) },
        ).also { driveRecorder = it }
    }
  }

  fun speedLimitPackStore(context: Context): SpeedLimitPackStore {
    speedLimitPackStore?.let {
      return it
    }

    return synchronized(this) {
      speedLimitPackStore
        ?: SpeedLimitPackStore(File(context.applicationContext.noBackupFilesDir, "speed_limit_packs")).also {
          speedLimitPackStore = it
        }
    }
  }

  fun deleteSpeedLimitPacks(context: Context) {
    SpeedLimitPackWorker.cancel(context)
    speedLimitPackStore(context).clear()
  }

  fun isDriveDetectionOn(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("driveDetection", true)

  fun setDriveDetection(
    context: Context,
    on: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("driveDetection", on).commit())
    if (!on) {
      driveRecorder(context).discard()
      deleteSpeedLimitPacks(context)
      stopCrashWatch(context)
    }
    TrackingCaptureService.showNoticeNow(context)
  }

  fun isCrashAlertsOn(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("crashAlerts", true)

  fun areCrashAlertsActive(context: Context): Boolean = isDriveDetectionOn(context) && isCrashAlertsOn(context)

  fun setCrashAlerts(
    context: Context,
    on: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("crashAlerts", on).commit())
    if (!on) stopCrashWatch(context)
  }

  fun crashAlertOutbox(context: Context): CrashAlertOutbox =
    crashAlertOutbox ?: synchronized(this) {
      crashAlertOutbox ?: CrashAlertOutbox(PrefsCrashAlertStore(context.applicationContext)).also { crashAlertOutbox = it }
    }

  fun crashSharingUntil(context: Context): Long? =
    context.getSharedPreferences("openbeacon_crash_alerts", Context.MODE_PRIVATE).getLong("sharingUntil", 0L).takeIf { it > 0L }

  fun isCrashSharing(
    context: Context,
    nowMillis: Long,
  ): Boolean = CrashAlertOutbox.isSharing(crashSharingUntil(context), nowMillis)

  fun setCrashSharingUntil(
    context: Context,
    untilMillis: Long?,
  ) {
    context.getSharedPreferences("openbeacon_crash_alerts", Context.MODE_PRIVATE).edit().putLong("sharingUntil", untilMillis ?: 0L).apply()
    TrackingCaptureService.refreshNow(context)
  }

  fun stopCrashWatch(context: Context) {
    CrashSensor.stop(context)
    crashDetector.reset()
    CrashCountdownController.cancelIfCounting(context)
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
      driveDetectionOff = { !isDriveDetectionOn(context) },
      crashAlertsOff = { !areCrashAlertsActive(context) },
      driveAlertsOff = { groupId -> !tellsGroup(context, groupId) },
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
      onRowFailure = { groupId, error -> Log.e("TrackingRuntime", "Failed to encrypt a location for group $groupId.", error) },
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

  private fun quietGroupKey(
    owner: String,
    groupId: String,
  ) = org.json.JSONArray(listOf(owner, groupId)).toString()

  fun tellsGroup(
    context: Context,
    groupId: String,
  ): Boolean {
    val owner = queueOwner(context) ?: return true
    return quietGroupKey(owner, groupId) !in
      context.getSharedPreferences("openbeacon_drive_alerts", Context.MODE_PRIVATE).getStringSet("quietGroups", emptySet()).orEmpty()
  }

  fun quietGroups(context: Context): List<String> {
    val owner = queueOwner(context) ?: return emptyList()
    return context
      .getSharedPreferences("openbeacon_drive_alerts", Context.MODE_PRIVATE)
      .getStringSet("quietGroups", emptySet())
      .orEmpty()
      .mapNotNull { key -> org.json.JSONArray(key).takeIf { it.optString(0) == owner }?.optString(1) }
  }

  fun setTellGroup(
    context: Context,
    groupId: String,
    tell: Boolean,
  ) {
    val owner = queueOwner(context) ?: throw IllegalStateException("No signed-in owner.")
    val preferences = context.getSharedPreferences("openbeacon_drive_alerts", Context.MODE_PRIVATE)
    val current = preferences.getStringSet("quietGroups", emptySet()).orEmpty()
    val key = quietGroupKey(owner, groupId)
    check(preferences.edit().putStringSet("quietGroups", if (tell) current - key else current + key).commit())
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
        driveQueue(context).deleteByOwner(null)
        crashAlertOutbox(context).clear()
        setCrashSharingUntil(context, null)
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

  fun isLowPowerMode(context: Context): Boolean =
    context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).getBoolean("lowPowerMode", false)

  fun setLowPowerMode(
    context: Context,
    enabled: Boolean,
  ) {
    check(context.getSharedPreferences("openbeacon_tracking_capture", Context.MODE_PRIVATE).edit().putBoolean("lowPowerMode", enabled).commit())
  }

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
