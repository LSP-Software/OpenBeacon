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

class TrackingCaptureService : Service() {
  private val fusedLocationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }
  private val capturePipeline by lazy { TrackingRuntime.capturePipeline(this) }

  private val locationCallback =
    object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        val location = result.lastLocation ?: return
        enqueueEncryptedFix(location)
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
        val intervalMs =
          intent?.getLongExtra(EXTRA_INTERVAL_MS, DEFAULT_INTERVAL_MS) ?: DEFAULT_INTERVAL_MS
        startCapture(intervalMs.coerceAtLeast(MIN_INTERVAL_MS))
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    stopCapture()
    super.onDestroy()
  }

  private fun startCapture(intervalMs: Long) {
    ensureNotificationChannel()
    val notification = buildNotification()
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
    )

    val request =
      LocationRequest
        .Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, intervalMs)
        .setMinUpdateIntervalMillis(intervalMs)
        .setMaxUpdateDelayMillis(intervalMs)
        .build()

    try {
      fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
      TrackingRuntime.isCaptureRunning = true
    } catch (_: SecurityException) {
      stopCapture()
      stopSelf()
    }
  }

  private fun stopCapture() {
    fusedLocationClient.removeLocationUpdates(locationCallback)
    TrackingRuntime.isCaptureRunning = false
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

    capturePipeline.onFix(
      latitude = location.latitude,
      longitude = location.longitude,
      timestampIso = formatTimestamp(location.time),
      speedMetersPerSecond = speed,
      batteryLevel = battery.level,
      batteryCharging = battery.charging,
    )
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

  companion object {
    const val ACTION_START = "expo.modules.openbeacontracking.action.START"
    const val ACTION_STOP = "expo.modules.openbeacontracking.action.STOP"
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val DEFAULT_INTERVAL_MS = 30_000L
    const val MIN_INTERVAL_MS = 5_000L
    private const val CHANNEL_ID = "openbeacon_tracking_capture"
    private const val NOTIFICATION_ID = 7260
  }
}
