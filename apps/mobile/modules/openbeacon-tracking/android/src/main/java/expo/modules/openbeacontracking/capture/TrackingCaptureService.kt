package expo.modules.openbeacontracking.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.Handler
import android.os.SystemClock
import android.text.format.DateFormat
import android.text.format.DateUtils
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import expo.modules.openbeacontracking.Notice
import expo.modules.openbeacontracking.NoticeSlot
import expo.modules.openbeacontracking.Notices
import expo.modules.openbeacontracking.R
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.crash.CrashCountdownController
import expo.modules.openbeacontracking.crash.CrashSensor
import expo.modules.openbeacontracking.drives.DriveFix
import expo.modules.openbeacontracking.drives.DriveSensors
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import java.util.Calendar
import java.util.Date
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class TrackingCaptureService : Service() {
  private val fusedLocationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }
  private val capturePipeline by lazy { TrackingRuntime.capturePipeline(this) }
  private val captureScope =
    CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
  private val captureStateLock = TrackingRuntime.captureLock
  private val driveSensors by lazy { DriveSensors(this, TrackingRuntime.driveRecorder(this)) }

  private var currentIntervalMs = DEFAULT_INTERVAL_MS
  private var lastQueued: LastQueuedFix? = null
  private var lastUploadRequestMs = 0L
  private var placeUploadWaiting = false
  private var currentUploadIntervalMs = CaptureSamplingPolicy.UPLOAD_INTERVAL_MS
  private val refreshState = CaptureRefreshState()

  private var locationCallback: LocationCallback? = null
  private var locateCancellation: CancellationTokenSource? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  @Volatile
  private var minimumFixElapsedRealtimeNanos = 0L
  private val sharingHandler = Handler(Looper.getMainLooper())
  private val resumeSharing = Runnable { updateSharing() }
  private val resumeSharingIntent by lazy {
    PendingIntent.getService(this, 7261, Intent(this, TrackingCaptureService::class.java).apply {
      action = ACTION_CHECK_SHARING
    }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private val showNoticeIntent by lazy {
    PendingIntent.getService(this, 7262, Intent(this, TrackingCaptureService::class.java).apply {
      action = ACTION_SHOW_NOTICE
    }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private val openAppIntent by lazy {
    packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      PendingIntent.getActivity(this, NOTIFICATION_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }

  private val openDriveDetectionIntent by lazy {
    PendingIntent.getActivity(
      this,
      NOTIFICATION_ID + 1,
      Intent(Intent.ACTION_VIEW, Uri.parse(DRIVE_DETECTION_LINK)).setPackage(packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(
    intent: Intent?,
    flags: Int,
    startId: Int,
  ): Int {
    when (intent?.action) {
      ACTION_CHECK_SHARING -> {
        if (!TrackingRuntime.isCaptureRunning && TrackingRuntime.shouldRestoreCapture(this)) {
          if (TrackingRuntime.isCaptureParked(this)) return parkCapture()
          startCapture(resolveStartIntervalMs(intent))
        }
        if (TrackingRuntime.isCaptureRunning) {
          requestSharingSync()
          updateSharing()
        } else {
          stopAfterFailedStart()
          return START_NOT_STICKY
        }
      }
      ACTION_SHARING_CHANGED -> {
        if (!TrackingRuntime.isCaptureRunning && TrackingRuntime.shouldRestoreCapture(this)) {
          if (TrackingRuntime.isCaptureParked(this)) return parkCapture()
          startCapture(resolveStartIntervalMs(intent))
        }
        if (TrackingRuntime.isCaptureRunning) updateSharing()
        else {
          stopAfterFailedStart()
          return START_NOT_STICKY
        }
      }
      ACTION_SHOW_NOTICE -> {
        if (!TrackingRuntime.isCaptureRunning) {
          stopSelf()
          return START_NOT_STICKY
        }
        showNotice()
      }
      ACTION_STOP -> {
        stopCapture()
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_REFRESH -> {
        if (!TrackingRuntime.isCaptureRunning) {
          stopSelf()
          return START_NOT_STICKY
        }
        if (TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis())) return START_STICKY
        val generation = synchronized(captureStateLock) {
          refreshState.request()
          TrackingRuntime.captureCommands.current()
        }
        if (intent?.getBooleanExtra(EXTRA_LOCATE, false) == true) {
          locate(generation)
        } else {
          try {
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
              .addOnSuccessListener { location ->
                if (location != null) captureScope.launch { enqueueEncryptedFix(location, generation) }
              }
          } catch (error: SecurityException) {
            Log.e(TAG, "Failed to refresh location.", error)
          }
        }
      }
      else -> {
        synchronized(captureStateLock) {
          if (intent?.action != ACTION_START && !TrackingRuntime.shouldRestoreCapture(this)) {
            if (intent != null) return promoteAndStop()
            stopAfterFailedStart()
            return START_NOT_STICKY
          }
          if (intent?.action == ACTION_START && !TrackingRuntime.captureCommands.isCurrent(intent.getLongExtra(EXTRA_COMMAND_GENERATION, -1L)) && !TrackingRuntime.isCaptureEnabled(this)) {
            if (!TrackingRuntime.isCaptureRunning) stopSelf()
            return START_NOT_STICKY
          }
          // Android crashes the app if a startForegroundService start stops before startForeground, so only sticky restarts park without promoting.
          if (intent == null && TrackingRuntime.isCaptureParked(this)) return parkCapture()
          startCapture(resolveStartIntervalMs(intent), intent?.getBooleanExtra(EXTRA_RESUMING_SHARING, false) == true)
        }
        if (intent?.getBooleanExtra(EXTRA_LOCATE, false) == true && TrackingRuntime.isCaptureRunning && !TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis())) {
          locate(TrackingRuntime.captureCommands.current())
        }
      }
    }

    return if (TrackingRuntime.isCaptureRunning) START_STICKY else START_NOT_STICKY
  }

  override fun onDestroy() {
    stopCapture()
    captureScope.cancel()
    super.onDestroy()
  }

  private fun resolveStartIntervalMs(intent: Intent?): Long {
    val policyIntervalMs =
      CaptureSamplingPolicy
        .evaluate(
          battery = BatteryReader.read(this),
          speedMetersPerSecond = null,
          accuracyMeters = null,
          distanceFromLastQueuedMeters = null,
          timeSinceLastQueuedMs = null,
        ).intervalMs

    val overrideIntervalMs =
      if (intent?.hasExtra(EXTRA_INTERVAL_MS) == true) {
        intent.getLongExtra(EXTRA_INTERVAL_MS, policyIntervalMs)
      } else {
        null
      }

    return (overrideIntervalMs ?: policyIntervalMs).coerceAtLeast(MIN_INTERVAL_MS)
  }

  private fun startCapture(
    intervalMs: Long,
    resumingSharing: Boolean = false,
  ) {
    ensureNotificationChannel()
    val notification = buildNotification()

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
      synchronized(captureStateLock) {
        TrackingRuntime.isCaptureRunning = true
      }
      SharingResumeWorker.cancel(this)
      Notices.dismiss(this, NoticeSlot.LOCATION_PERMISSION)
      Notices.dismiss(this, NoticeSlot.SHARING_CHANGED)
      currentIntervalMs = intervalMs
      watchConnectivity()
      captureScope.launch { finishStaleDrive() }
      CrashCountdownController.resume(this)
      updateSharing()
    } catch (error: SecurityException) {
      Log.e(TAG, "Failed to start location capture.", error)
      stopCapture()
      if (resumingSharing) {
        stopSelf()
        SharingResumeWorker.showNotice(this)
      } else {
        stopAfterFailedStart()
      }
    } catch (error: IllegalStateException) {
      Log.e(TAG, "Android didn't allow location capture to start in the background.", error)
      stopCapture()
      stopSelf()
      if (resumingSharing) SharingResumeWorker.showNotice(this)
    }
  }

  private fun promoteAndStop(): Int {
    ensureNotificationChannel()
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } catch (error: RuntimeException) {
      Log.w(TAG, "Failed to promote a capture start that can no longer restore sharing.", error)
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopAfterFailedStart()
    return START_NOT_STICKY
  }

  private fun parkCapture(): Int {
    SharingResumeWorker.schedule(this)
    stopSelf()
    return START_NOT_STICKY
  }

  private fun requestLocationUpdates(intervalMs: Long) {
    val request =
      LocationRequest
        .Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
        .setMinUpdateIntervalMillis(intervalMs)
        .setMaxUpdateDelayMillis(if (intervalMs == DRIVE_INTERVAL_MS) DRIVE_BATCH_MS else intervalMs)
        .build()

    locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
    val generation = TrackingRuntime.captureCommands.current()
    val callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        val location = result.lastLocation ?: return
        val locations = result.locations
        captureScope.launch {
          recordDrive(locations, generation)
          updateDriveSensors()
          enqueueEncryptedFix(location, generation)
          if (isOnline()) requestUploadIfDue(generation)
        }
      }
    }
    locationCallback = callback
    fusedLocationClient.requestLocationUpdates(request, callback, Looper.getMainLooper())
    synchronized(captureStateLock) {
      currentIntervalMs = intervalMs
    }
  }

  private fun locate(generation: Long) {
    val cancellation = CancellationTokenSource()
    synchronized(captureStateLock) {
      locateCancellation?.cancel()
      locateCancellation = cancellation
    }
    val request =
      CurrentLocationRequest
        .Builder()
        .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
        .setMaxUpdateAgeMillis(0)
        .setDurationMillis(LOCATE_TIMEOUT_MS)
        .build()
    try {
      fusedLocationClient.getCurrentLocation(request, cancellation.token)
        .addOnSuccessListener { location ->
          if (location == null) uploadAfterLocate(generation)
          else captureScope.launch { if (!enqueueEncryptedFix(location, generation)) uploadAfterLocate(generation) }
        }
        .addOnFailureListener { error ->
          Log.w(TAG, "Failed to locate the phone.", error)
          uploadAfterLocate(generation)
        }
    } catch (error: SecurityException) {
      Log.e(TAG, "Failed to locate the phone.", error)
      uploadAfterLocate(generation)
    }
  }

  private fun uploadAfterLocate(generation: Long) {
    val nowMs = System.currentTimeMillis()
    if (TrackingRuntime.sharingState(this).isPaused(nowMs)) return
    synchronized(captureStateLock) {
      if (!TrackingRuntime.isCaptureRunning || !TrackingRuntime.captureCommands.isCurrent(generation)) return
      try {
        startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, TrackingUploadService.REASON_UPLOAD))
        lastUploadRequestMs = nowMs
        placeUploadWaiting = false
      } catch (error: Exception) {
        Log.e(TAG, "Failed to start background tracking sync.", error)
      }
    }
  }

  private fun watchConnectivity() {
    val connectivity = getSystemService(ConnectivityManager::class.java) ?: return
    networkCallback?.let { connectivity.unregisterNetworkCallback(it) }
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        captureScope.launch { requestUploadIfDue(TrackingRuntime.captureCommands.current()) }
      }
    }
    try {
      connectivity.registerDefaultNetworkCallback(callback)
      networkCallback = callback
    } catch (error: RuntimeException) {
      networkCallback = null
      Log.e(TAG, "Failed to watch for connectivity.", error)
    }
  }

  private fun requestUploadIfDue(generation: Long) {
    val nowMs = System.currentTimeMillis()
    val worthChecking =
      synchronized(captureStateLock) { placeUploadWaiting || nowMs - lastUploadRequestMs >= currentUploadIntervalMs }
    if (!worthChecking || TrackingRuntime.sharingState(this).isPaused(nowMs) || !hasPendingUploads()) return
    synchronized(captureStateLock) {
      val startUpload =
        UploadRequestPolicy.shouldStart(
          generationCurrent = TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation),
          online = true,
          paused = false,
          placeTransitionQueued = placeUploadWaiting,
          pointQueued = true,
          forceUpload = false,
          msSinceLastRequest = nowMs - lastUploadRequestMs,
          uploadIntervalMs = currentUploadIntervalMs,
        )
      if (startUpload) {
        try {
          startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "upload"))
          lastUploadRequestMs = nowMs
          placeUploadWaiting = false
        } catch (error: Exception) {
          Log.e(TAG, "Failed to start background tracking sync.", error)
        }
      }
    }
  }

  private fun stopCapture() {
    interruptDrive()
    driveSensors.update(false)
    networkCallback?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
    networkCallback = null
    sharingHandler.removeCallbacks(resumeSharing)
    getSystemService(AlarmManager::class.java)?.cancel(resumeSharingIntent)
    locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
    locationCallback = null
    synchronized(captureStateLock) {
      TrackingRuntime.isCaptureRunning = false
      lastQueued = null
      refreshState.clear()
      locateCancellation?.cancel()
      locateCancellation = null
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun updateSharing() {
    TrackingRuntime.placeDetection(this).restart()
    sharingHandler.removeCallbacks(resumeSharing)
    getSystemService(AlarmManager::class.java)?.cancel(resumeSharingIntent)
    val sharing = TrackingRuntime.sharingState(this)
    if (sharing.isConfirmedIndefinitePause()) {
      stopCapture()
      parkCapture()
      return
    }
    if (sharing.isPaused(System.currentTimeMillis())) {
      interruptDrive()
      driveSensors.update(false)
      synchronized(captureStateLock) {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
      }
      val nextCheck = minOf(sharing.pausedUntil ?: Long.MAX_VALUE, System.currentTimeMillis() + 300_000L)
      getSystemService(AlarmManager::class.java)?.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextCheck, resumeSharingIntent)
      sharing.pausedUntil?.let {
        sharingHandler.postDelayed(resumeSharing, (it - System.currentTimeMillis()).coerceAtLeast(1L))
      }
    } else {
      try {
        synchronized(captureStateLock) {
          lastQueued = null
          lastUploadRequestMs = 0L
          placeUploadWaiting = false
          refreshState.request()
        }
        minimumFixElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        synchronized(captureStateLock) {
          requestLocationUpdates(currentIntervalMs)
        }
      } catch (error: SecurityException) {
        Log.e(TAG, "Failed to resume location sharing.", error)
        stopCapture()
        stopAfterFailedStart()
        return
      }
    }
    showNotice()
  }

  private fun showNotice() {
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun stopAfterFailedStart() {
    if (TrackingRuntime.hasLostLocationPermission(this)) Notices.show(this, Notice.LOCATION_PERMISSION)
    stopSelf()
  }

  private fun requestSharingSync() {
    try {
      startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "sharing"))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to check location sharing preferences.", error)
    }
  }

  private fun enqueueEncryptedFix(location: Location, generation: Long): Boolean {
    if (location.elapsedRealtimeNanos <= minimumFixElapsedRealtimeNanos) return false
    val battery = BatteryReader.read(this)
    val speed =
      if (location.hasSpeed()) {
        location.speed.toDouble()
      } else {
        null
      }
    val accuracy = location.accuracy.toDouble().takeIf { location.hasAccuracy() }
    val nowMs = System.currentTimeMillis()
    val (queued, intervalMs, captureRunning) =
      synchronized(captureStateLock) {
        Triple(lastQueued, currentIntervalMs, TrackingRuntime.isCaptureRunning)
      }

    if (!captureRunning || !TrackingRuntime.captureCommands.isCurrent(generation)) {
      return false
    }

    val placeTransitionQueued = detectPlaces(location, nowMs, generation)

    val refreshGeneration = synchronized(captureStateLock) { refreshState.pending() }
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery,
        speedMetersPerSecond = speed,
        accuracyMeters = accuracy,
        distanceFromLastQueuedMeters =
          queued?.let {
            distanceMeters(it.latitude, it.longitude, location.latitude, location.longitude)
          },
        timeSinceLastQueuedMs = queued?.let { nowMs - it.atMs },
        forcedRefresh = refreshGeneration != null,
        lowPowerMode = TrackingRuntime.isLowPowerMode(this),
        confirmingPlace = isConfirmingPlace(location.time),
      )

    val nextIntervalMs =
      if (TrackingRuntime.isDriveDetectionOn(this) && TrackingRuntime.driveRecorder(this).wantsFastFixes) {
        DRIVE_INTERVAL_MS
      } else {
        decision.intervalMs.coerceAtLeast(MIN_INTERVAL_MS)
      }
    if (nextIntervalMs != intervalMs) {
      try {
        synchronized(captureStateLock) {
          if (TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation)) requestLocationUpdates(nextIntervalMs)
        }
      } catch (error: SecurityException) {
        Log.e(TAG, "Failed to retune location interval.", error)
      }
    }

    synchronized(captureStateLock) {
      currentUploadIntervalMs = decision.uploadIntervalMs
    }

    var currentFixQueued = false
    try {
      capturePipeline.onFix(
        latitude = location.latitude,
        longitude = location.longitude,
        timestampMillis = location.time,
        speedMetersPerSecond = speed,
        batteryLevel = battery.level.takeIf { battery.levelKnown },
        batteryCharging = battery.charging,
        captureGeneration = generation,
        fixId = location.elapsedRealtimeNanos.takeIf { it > 0 },
        accuracyMeters = accuracy,
        live = decision.shouldQueue,
        onCurrentFixQueued = { currentFixQueued = true },
      )
      synchronized(captureStateLock) {
        if (TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation) && currentFixQueued) {
          if (refreshGeneration != null) refreshState.complete(refreshGeneration)
          lastQueued =
            LastQueuedFix(
              latitude = location.latitude,
              longitude = location.longitude,
              atMs = nowMs,
            )
        }
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to encrypt and queue location fix.", error)
    }

    val online = isOnline()
    val paused = TrackingRuntime.sharingState(this).isPaused(nowMs)
    return try {
      synchronized(captureStateLock) {
        if (placeTransitionQueued) placeUploadWaiting = true
        val startUpload =
          UploadRequestPolicy.shouldStart(
            generationCurrent = TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation),
            online = online,
            paused = paused,
            placeTransitionQueued = placeUploadWaiting,
            pointQueued = currentFixQueued,
            forceUpload = decision.forceUpload,
            msSinceLastRequest = nowMs - lastUploadRequestMs,
            uploadIntervalMs = decision.uploadIntervalMs,
          )
        if (startUpload) {
          startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "upload"))
          lastUploadRequestMs = nowMs
          placeUploadWaiting = false
        }
        startUpload
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to start background tracking sync.", error)
      false
    }
  }

  private fun detectPlaces(location: Location, nowMs: Long, generation: Long): Boolean =
    try {
      synchronized(TrackingRuntime.captureLock) {
        if (!TrackingRuntime.captureCommands.isCurrent(generation)) return false
        val owner = TrackingRuntime.queueOwner(this) ?: return false
        val deviceId = TrackingRuntime.queueDeviceId(this) ?: return false
        TrackingRuntime.placeDetection(this).onFix(
          owner = owner,
          deviceId = deviceId,
          sharing = TrackingRuntime.sharingState(this),
          nowMillis = nowMs,
          latitude = location.latitude,
          longitude = location.longitude,
          accuracyMeters = location.accuracy.toDouble().takeIf { location.hasAccuracy() },
          timestampMillis = location.time,
          speedMetersPerSecond = location.speed.toDouble().takeIf { location.hasSpeed() },
          onArrive = { captureScope.launch { endDriveAtPlace() } },
        ) > 0
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to check places.", error)
      false
    }

  private fun recordDrive(locations: List<Location>, generation: Long) {
    if (!TrackingRuntime.isDriveDetectionOn(this)) return
    val owner = TrackingRuntime.queueOwner(this) ?: return
    val captureCurrent = synchronized(captureStateLock) { TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation) }
    if (!captureCurrent || TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis())) return
    val recorder = TrackingRuntime.driveRecorder(this)
    val wasRecording = recorder.recording
    try {
      if (TrackingRuntime.epochKeyStore(this).list().isEmpty()) {
        recorder.interrupt(owner)
      } else {
        val batterySaver = CaptureSamplingPolicy.isBatterySaver(BatteryReader.read(this))
        val fixes =
          locations
            .filter { it.elapsedRealtimeNanos > minimumFixElapsedRealtimeNanos }
            .sortedBy { it.time }
            .map { location ->
              DriveFix(
                timeMillis = location.time,
                latitude = location.latitude,
                longitude = location.longitude,
                speed = location.speed.toDouble().takeIf { location.hasSpeed() },
                accuracy = location.accuracy.toDouble().takeIf { location.hasAccuracy() },
                batterySaver = batterySaver,
              )
            }
        recorder.onFixes(owner, fixes)
        watchForCrash(fixes, wasRecording || recorder.recording, recorder.recording)
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to record a drive.", error)
    }
    if (recorder.recording != wasRecording) showNotice()
  }

  private fun updateDriveSensors() {
    val watching =
      TrackingRuntime.isCaptureRunning &&
        TrackingRuntime.isDriveDetectionOn(this) &&
        !TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis()) &&
        TrackingRuntime.driveRecorder(this).wantsSensors
    driveSensors.update(watching)
  }

  private fun watchForCrash(
    fixes: List<DriveFix>,
    inDrive: Boolean,
    recording: Boolean,
  ) {
    if (!TrackingRuntime.areCrashAlertsActive(this)) {
      CrashSensor.stop(this)
      return
    }
    fixes.forEach { fix ->
      TrackingRuntime.crashDetector.onFix(fix, inDrive)?.let { CrashCountdownController.start(this, it, test = false) }
    }
    CrashSensor.watch(this, recording)
  }

  private fun endDriveAtPlace() {
    if (!TrackingRuntime.isDriveDetectionOn(this)) return
    val owner = TrackingRuntime.queueOwner(this) ?: return
    val recorder = TrackingRuntime.driveRecorder(this)
    if (!recorder.recording) return
    try {
      recorder.onPlaceArrive(owner)
    } catch (error: Exception) {
      Log.e(TAG, "Failed to end a drive at a place.", error)
    }
    showNotice()
  }

  private fun interruptDrive() {
    CrashSensor.stop(this)
    val owner = TrackingRuntime.queueOwner(this) ?: return
    val recorder = TrackingRuntime.driveRecorder(this)
    if (!recorder.recording) return
    try {
      recorder.interrupt(owner)
    } catch (error: Exception) {
      Log.e(TAG, "Failed to end a drive.", error)
    }
  }

  private fun finishStaleDrive() {
    val owner = TrackingRuntime.queueOwner(this) ?: return
    try {
      TrackingRuntime.driveRecorder(this).tick(owner, System.currentTimeMillis())
    } catch (error: Exception) {
      Log.e(TAG, "Failed to finish a drive.", error)
    }
  }

  private fun isConfirmingPlace(nowMillis: Long): Boolean =
    try {
      TrackingRuntime.placeDetection(this).isConfirming(nowMillis)
    } catch (error: Exception) {
      Log.e(TAG, "Failed to check places.", error)
      false
    }

  private fun hasPendingUploads(): Boolean =
    try {
      val owner = TrackingRuntime.queueOwner(this)
      TrackingRuntime
        .ciphertextQueue(this)
        .listByStatus(CiphertextQueueRow.STATUS_PENDING, 1, owner, exceptRole = CiphertextQueueRow.ROLE_STAY)
        .isNotEmpty() || (owner != null && TrackingRuntime.placeDetection(this).hasQueued(owner))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to check for pending uploads.", error)
      false
    }

  private fun isOnline(): Boolean {
    val connectivity = getSystemService(ConnectivityManager::class.java) ?: return false
    val network = connectivity.activeNetwork ?: return false
    return connectivity.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
  }

  private fun distanceMeters(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
  ): Double {
    val results = FloatArray(1)
    Location.distanceBetween(fromLatitude, fromLongitude, toLatitude, toLongitude, results)
    return results[0].toDouble()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        getString(R.string.openbeacon_tracking_notification_channel),
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = getString(R.string.openbeacon_tracking_notification_channel_description)
        setShowBadge(false)
      }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val sharing = TrackingRuntime.sharingState(this)
    val paused = sharing.isPaused(System.currentTimeMillis())
    val recordingDrive = !paused && TrackingRuntime.isDriveDetectionOn(this) && TrackingRuntime.driveRecorder(this).recording
    val pausedUntil = sharing.pausedUntil
    val body =
      when {
        !paused -> getString(R.string.openbeacon_tracking_notification_body)
        pausedUntil == null -> getString(R.string.openbeacon_tracking_notification_paused_body)
        isOnDay(pausedUntil, 0) ->
          getString(R.string.openbeacon_tracking_notification_paused_until_body, DateFormat.getTimeFormat(this).format(Date(pausedUntil)))
        isOnDay(pausedUntil, 1) ->
          getString(R.string.openbeacon_tracking_notification_paused_until_tomorrow_body, DateFormat.getTimeFormat(this).format(Date(pausedUntil)))
        else ->
          getString(
            R.string.openbeacon_tracking_notification_paused_until_day_body,
            DateUtils.formatDateTime(this, pausedUntil, DateUtils.FORMAT_SHOW_WEEKDAY or DateUtils.FORMAT_SHOW_DATE),
            DateFormat.getTimeFormat(this).format(Date(pausedUntil)),
          )
      }
    return NotificationCompat
      .Builder(this, CHANNEL_ID)
      .setContentTitle(
        getString(
          when {
            paused -> R.string.openbeacon_tracking_notification_paused_title
            recordingDrive -> R.string.openbeacon_tracking_notification_drive_title
            else -> R.string.openbeacon_tracking_notification_title
          },
        ),
      )
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setSmallIcon(R.drawable.openbeacon_notification_icon)
      .setColor(ContextCompat.getColor(this, R.color.openbeacon_notification_color))
      .setContentIntent(if (recordingDrive) openDriveDetectionIntent else openAppIntent)
      .setDeleteIntent(showNoticeIntent)
      .setShowWhen(false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  private fun isOnDay(
    epochMillis: Long,
    daysAhead: Int,
  ): Boolean {
    val day = Calendar.getInstance().apply { timeInMillis = epochMillis }
    val target = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, daysAhead) }
    return day.get(Calendar.YEAR) == target.get(Calendar.YEAR) && day.get(Calendar.DAY_OF_YEAR) == target.get(Calendar.DAY_OF_YEAR)
  }

  private data class LastQueuedFix(
    val latitude: Double,
    val longitude: Double,
    val atMs: Long,
  )

  companion object {
    const val ACTION_START = "expo.modules.openbeacontracking.action.START"
    const val ACTION_REFRESH = "expo.modules.openbeacontracking.action.REFRESH"
    const val ACTION_SHARING_CHANGED = "expo.modules.openbeacontracking.action.SHARING_CHANGED"
    const val ACTION_CHECK_SHARING = "expo.modules.openbeacontracking.action.CHECK_SHARING"
    const val ACTION_STOP = "expo.modules.openbeacontracking.action.STOP"
    const val ACTION_SHOW_NOTICE = "expo.modules.openbeacontracking.action.SHOW_NOTICE"
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val EXTRA_COMMAND_GENERATION = "captureCommandGeneration"
    const val EXTRA_RESUMING_SHARING = "resumingSharing"
    const val EXTRA_LOCATE = "locate"
    const val DEFAULT_INTERVAL_MS = CaptureSamplingPolicy.DEFAULT_INTERVAL_MS
    const val MIN_INTERVAL_MS = 5_000L
    private const val DRIVE_INTERVAL_MS = 1_000L
    private const val DRIVE_BATCH_MS = 10_000L
    private const val DRIVE_DETECTION_LINK = "openbeacon:///account/drive-detection"
    private const val TAG = "TrackingCapture"
    const val CHANNEL_ID = "openbeacon_tracking_capture"
    private const val NOTIFICATION_ID = 7260
    private const val LOCATE_TIMEOUT_MS = 20_000L
    private var locateWakes = LocateWakePolicy { SystemClock.elapsedRealtime() }

    fun isNoticeMissing(context: Context): Boolean {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return false
      val canShow =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
          NotificationManagerCompat.from(context).getNotificationChannelCompat(CHANNEL_ID)?.importance != NotificationManagerCompat.IMPORTANCE_NONE
      return canShow && manager.activeNotifications.none { it.id == NOTIFICATION_ID }
    }

    fun showNoticeNow(context: Context) {
      if (!TrackingRuntime.isCaptureRunning) return
      try {
        context.startService(Intent(context, TrackingCaptureService::class.java).apply { action = ACTION_SHOW_NOTICE })
      } catch (error: IllegalStateException) {
        Log.w(TAG, "Android didn't allow the sharing notice to be updated.", error)
      }
    }

    fun showNoticeIfMissing(context: Context) {
      if (!TrackingRuntime.isCaptureRunning || !isNoticeMissing(context)) return
      try {
        context.startService(Intent(context, TrackingCaptureService::class.java).apply { action = ACTION_SHOW_NOTICE })
      } catch (error: IllegalStateException) {
        Log.w(TAG, "Android didn't allow the sharing notice to be shown again.", error)
      }
    }

    fun locateNow(context: Context) {
      TrackingUploadService.start(context, TrackingUploadService.REASON_PUSH)
      val decision =
        locateWakes.decide(
          captureRunning = TrackingRuntime.isCaptureRunning,
          captureRestorable = TrackingRuntime.shouldRestoreCapture(context),
          parked = TrackingRuntime.isCaptureParked(context),
          paused = TrackingRuntime.sharingState(context).isPaused(System.currentTimeMillis()),
        )
      when (decision) {
        LocateWakePolicy.Action.SYNC -> Unit
        LocateWakePolicy.Action.RESTART ->
          try {
            ContextCompat.startForegroundService(context, Intent(context, TrackingCaptureService::class.java).putExtra(EXTRA_LOCATE, true))
          } catch (error: IllegalStateException) {
            Log.w(TAG, "Android didn't allow location capture to restart in the background.", error)
            TrackingUploadService.start(context, TrackingUploadService.REASON_UPLOAD)
          } catch (error: SecurityException) {
            Log.e(TAG, "Failed to restart location capture.", error)
            TrackingUploadService.start(context, TrackingUploadService.REASON_UPLOAD)
          }
        LocateWakePolicy.Action.REFRESH ->
          try {
            context.startService(
              Intent(context, TrackingCaptureService::class.java).apply {
                action = ACTION_REFRESH
                putExtra(EXTRA_LOCATE, true)
              },
            )
          } catch (error: IllegalStateException) {
            Log.w(TAG, "Android didn't allow a location update in the background.", error)
            TrackingUploadService.start(context, TrackingUploadService.REASON_UPLOAD)
          }
      }
    }
  }
}
