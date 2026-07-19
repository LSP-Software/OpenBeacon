package expo.modules.openbeacontracking.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
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
  private val captureStateLock = Any()

  private var currentIntervalMs = DEFAULT_INTERVAL_MS
  private var lastQueued: LastQueuedFix? = null

  private val locationCallback =
    object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        val location = result.lastLocation ?: return
        captureScope.launch {
          enqueueEncryptedFix(location)
        }
      }
    }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(
    intent: Intent?,
    flags: Int,
    startId: Int,
  ): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopCapture()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        startCapture(resolveStartIntervalMs(intent))
      }
    }

    return START_STICKY
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

  private fun startCapture(intervalMs: Long) {
    ensureNotificationChannel()
    val notification = buildNotification()

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
      requestLocationUpdates(intervalMs)
      synchronized(captureStateLock) {
        TrackingRuntime.isCaptureRunning = true
      }
    } catch (error: SecurityException) {
      Log.e(TAG, "Failed to start location capture.", error)
      stopCapture()
      stopSelf()
    }
  }

  private fun requestLocationUpdates(intervalMs: Long) {
    val request =
      LocationRequest
        .Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
        .setMinUpdateIntervalMillis(intervalMs)
        .setMaxUpdateDelayMillis(intervalMs)
        .build()

    fusedLocationClient.removeLocationUpdates(locationCallback)
    fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
    synchronized(captureStateLock) {
      currentIntervalMs = intervalMs
    }
  }

  private fun stopCapture() {
    fusedLocationClient.removeLocationUpdates(locationCallback)
    synchronized(captureStateLock) {
      TrackingRuntime.isCaptureRunning = false
      lastQueued = null
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun enqueueEncryptedFix(location: Location) {
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

    if (!captureRunning) {
      return
    }

    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery,
        speedMetersPerSecond = speed,
        distanceFromLastQueuedMeters =
          queued?.let {
            distanceMeters(it.latitude, it.longitude, location.latitude, location.longitude)
          },
        timeSinceLastQueuedMs = queued?.let { nowMs - it.atMs },
      )

    val nextIntervalMs = decision.intervalMs.coerceAtLeast(MIN_INTERVAL_MS)
    if (nextIntervalMs != intervalMs) {
      try {
        requestLocationUpdates(nextIntervalMs)
      } catch (error: SecurityException) {
        Log.e(TAG, "Failed to retune location interval.", error)
      }
    }

    if (!decision.shouldQueue) {
      return
    }

    try {
      capturePipeline.onFix(
        latitude = location.latitude,
        longitude = location.longitude,
        timestampIso = formatTimestamp(location.time),
        speedMetersPerSecond = speed,
        batteryLevel = battery.level,
        batteryCharging = battery.charging,
      )
      synchronized(captureStateLock) {
        if (TrackingRuntime.isCaptureRunning) {
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
      .setContentText(getString(R.string.openbeacon_tracking_notification_body))
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
    const val ACTION_STOP = "expo.modules.openbeacontracking.action.STOP"
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val DEFAULT_INTERVAL_MS = CaptureSamplingPolicy.DEFAULT_INTERVAL_MS
    const val MIN_INTERVAL_MS = 5_000L
    private const val TAG = "TrackingCapture"
    private const val CHANNEL_ID = "openbeacon_tracking_capture"
    private const val NOTIFICATION_ID = 7260
  }
}
