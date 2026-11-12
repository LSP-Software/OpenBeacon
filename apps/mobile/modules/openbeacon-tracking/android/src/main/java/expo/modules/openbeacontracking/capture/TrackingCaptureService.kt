package expo.modules.openbeacontracking.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.Handler
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import expo.modules.openbeacontracking.R
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
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

  private var currentIntervalMs = DEFAULT_INTERVAL_MS
  private var lastQueued: LastQueuedFix? = null
  private var lastUploadRequestMs = 0L
  private var currentUploadIntervalMs = CaptureSamplingPolicy.UPLOAD_INTERVAL_MS
  private val refreshState = CaptureRefreshState()

  private var locationCallback: LocationCallback? = null
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
          stopSelf()
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
          stopSelf()
          return START_NOT_STICKY
        }
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
        try {
          fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { location ->
              if (location != null) captureScope.launch { enqueueEncryptedFix(location, generation) }
            }
        } catch (error: SecurityException) {
          Log.e(TAG, "Failed to refresh location.", error)
        }
      }
      else -> {
        synchronized(captureStateLock) {
          if (intent?.action != ACTION_START && !TrackingRuntime.shouldRestoreCapture(this)) {
            stopSelf()
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
      SharingResumeWorker.clearNotice(this)
      currentIntervalMs = intervalMs
      watchConnectivity()
      updateSharing()
    } catch (error: SecurityException) {
      Log.e(TAG, "Failed to start location capture.", error)
      stopCapture()
      stopSelf()
      if (resumingSharing) SharingResumeWorker.showNotice(this, TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis()))
    } catch (error: IllegalStateException) {
      Log.e(TAG, "Android didn't allow location capture to start in the background.", error)
      stopCapture()
      stopSelf()
      if (resumingSharing) SharingResumeWorker.showNotice(this, TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis()))
    }
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
        .setMaxUpdateDelayMillis(intervalMs)
        .build()

    locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
    val generation = TrackingRuntime.captureCommands.current()
    val callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        val location = result.lastLocation ?: return
        captureScope.launch {
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

  private fun watchConnectivity() {
    val connectivity = getSystemService(ConnectivityManager::class.java) ?: return
    networkCallback?.let { connectivity.unregisterNetworkCallback(it) }
    val generation = TrackingRuntime.captureCommands.current()
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        captureScope.launch { requestUploadIfDue(generation) }
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
    val uploadDue = synchronized(captureStateLock) { nowMs - lastUploadRequestMs >= currentUploadIntervalMs }
    if (!uploadDue || TrackingRuntime.sharingState(this).isPaused(nowMs) || !hasPendingUploads()) return
    synchronized(captureStateLock) {
      if (TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation) && nowMs - lastUploadRequestMs >= currentUploadIntervalMs) {
        try {
          startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "upload"))
          lastUploadRequestMs = nowMs
        } catch (error: Exception) {
          Log.e(TAG, "Failed to start background tracking sync.", error)
        }
      }
    }
  }

  private fun stopCapture() {
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
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun updateSharing() {
    sharingHandler.removeCallbacks(resumeSharing)
    getSystemService(AlarmManager::class.java)?.cancel(resumeSharingIntent)
    val sharing = TrackingRuntime.sharingState(this)
    if (sharing.isConfirmedIndefinitePause()) {
      stopCapture()
      parkCapture()
      return
    }
    if (sharing.isPaused(System.currentTimeMillis())) {
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
          refreshState.request()
        }
        minimumFixElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        synchronized(captureStateLock) {
          requestLocationUpdates(currentIntervalMs)
        }
      } catch (error: SecurityException) {
        Log.e(TAG, "Failed to resume location sharing.", error)
        stopCapture()
        stopSelf()
      }
    }
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun requestSharingSync() {
    try {
      startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "sharing"))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to check location sharing preferences.", error)
    }
  }

  private fun enqueueEncryptedFix(location: Location, generation: Long) {
    if (location.elapsedRealtimeNanos <= minimumFixElapsedRealtimeNanos) return
    val battery = BatteryReader.read(this)
    val speed =
      if (location.hasSpeed()) {
        location.speed.toDouble()
      } else {
        null
      }
    val nowMs = System.currentTimeMillis()
    val (queued, intervalMs, captureRunning) =
      synchronized(captureStateLock) {
        Triple(lastQueued, currentIntervalMs, TrackingRuntime.isCaptureRunning)
      }

    if (!captureRunning || !TrackingRuntime.captureCommands.isCurrent(generation)) {
      return
    }

    val refreshGeneration = synchronized(captureStateLock) { refreshState.pending() }
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery,
        speedMetersPerSecond = speed,
        distanceFromLastQueuedMeters =
          queued?.let {
            distanceMeters(it.latitude, it.longitude, location.latitude, location.longitude)
          },
        timeSinceLastQueuedMs = queued?.let { nowMs - it.atMs },
        forcedRefresh = refreshGeneration != null,
      )

    val nextIntervalMs = decision.intervalMs.coerceAtLeast(MIN_INTERVAL_MS)
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

    if (!decision.shouldQueue) {
      return
    }

    try {
      val queuedCount = capturePipeline.onFix(
        latitude = location.latitude,
        longitude = location.longitude,
        timestampIso = formatTimestamp(location.time),
        speedMetersPerSecond = speed,
        batteryLevel = battery.level,
        batteryCharging = battery.charging,
        captureGeneration = generation,
        fixId = location.elapsedRealtimeNanos.takeIf { it > 0 },
      )
      synchronized(captureStateLock) {
        if (TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation) && queuedCount > 0 && (decision.forceUpload || nowMs - lastUploadRequestMs >= decision.uploadIntervalMs) && isOnline()) {
          startService(Intent(this, TrackingUploadService::class.java).putExtra(TrackingUploadService.EXTRA_REASON, "upload"))
          lastUploadRequestMs = nowMs
        }
      }
      synchronized(captureStateLock) {
        if (TrackingRuntime.isCaptureRunning && TrackingRuntime.captureCommands.isCurrent(generation) && queuedCount > 0) {
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
  }

  private fun hasPendingUploads(): Boolean =
    try {
      TrackingRuntime
        .ciphertextQueue(this)
        .listByStatus(CiphertextQueueRow.STATUS_PENDING, 1, TrackingRuntime.queueOwner(this))
        .isNotEmpty()
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

  private fun formatTimestamp(epochMillis: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date(epochMillis))
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

  private fun buildNotification(): Notification =
    NotificationCompat
      .Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.openbeacon_tracking_notification_title))
      .setContentText(getString(if (TrackingRuntime.sharingState(this).isPaused(System.currentTimeMillis())) R.string.openbeacon_tracking_notification_paused_body else R.string.openbeacon_tracking_notification_body))
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()

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
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val EXTRA_COMMAND_GENERATION = "captureCommandGeneration"
    const val EXTRA_RESUMING_SHARING = "resumingSharing"
    const val DEFAULT_INTERVAL_MS = CaptureSamplingPolicy.DEFAULT_INTERVAL_MS
    const val MIN_INTERVAL_MS = 5_000L
    private const val TAG = "TrackingCapture"
    private const val CHANNEL_ID = "openbeacon_tracking_capture"
    private const val NOTIFICATION_ID = 7260
  }
}
