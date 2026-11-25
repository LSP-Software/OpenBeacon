package expo.modules.openbeacontracking.crash

import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.openbeacontracking.R
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.capture.TrackingUploadService
import expo.modules.openbeacontracking.drives.CrashAlertOutbox
import expo.modules.openbeacontracking.drives.CrashNotice
import expo.modules.openbeacontracking.drives.CrashNoticePolicy
import expo.modules.openbeacontracking.drives.CrashCountdown
import expo.modules.openbeacontracking.drives.CrashCountdownPhase
import expo.modules.openbeacontracking.drives.CrashSuspicion
import expo.modules.openbeacontracking.drives.EmergencyNumbers
import java.util.Locale
import org.json.JSONObject

object CrashCountdownController {
  private const val TAG = "CrashCountdown"
  private const val CHANNEL_ID = "openbeacon_crash_countdown"
  private const val QUIET_CHANNEL_ID = "openbeacon_crash_countdown_quiet"
  private const val GROUP = "openbeacon_crash"
  private const val NOTIFICATION_ID = 7270
  private const val PREFS = "openbeacon_crash_alerts"
  private const val COUNTDOWN_KEY = "countdown"
  private const val ALERT_KEY = "alertId"
  private const val DROPPED_ID = 7272
  private const val SENT_CHECK_MILLIS = 15_000L
  private val MPH_COUNTRIES = setOf("GB", "US", "LR", "MM", "PR", "VI", "GU", "AS", "MP", "BS", "BZ", "KY", "VG", "TC", "AG", "DM", "GD", "KN", "LC", "VC", "MS", "AI", "FK", "SH", "IM", "JE", "GG", "WS")

  private val handler = Handler(Looper.getMainLooper())
  private val listeners = mutableSetOf<() -> Unit>()
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null
  private lateinit var appContext: Context

  @Volatile
  var current: CrashCountdown? = null
    private set

  @Volatile
  var placeName: String? = null
    private set
  private var placeFor: Long? = null
  private var alertId: String? = null
  private var screenVisible = false
  private var shownNotice = CrashNotice.NONE

  private val sentChecker =
    object : Runnable {
      override fun run() {
        checkSent()
        if (current?.phase == CrashCountdownPhase.SENT) handler.postDelayed(this, SENT_CHECK_MILLIS)
      }
    }

  private val ticker =
    object : Runnable {
      override fun run() {
        val countdown = current ?: return
        update(countdown.tick(System.currentTimeMillis()))
        if (current?.phase == CrashCountdownPhase.COUNTING) handler.postDelayed(this, 1_000L - System.currentTimeMillis() % 1_000L)
      }
    }

  fun start(
    context: Context,
    suspicion: CrashSuspicion,
    test: Boolean,
  ) = onMain(context) {
    if (current?.phase == CrashCountdownPhase.COUNTING || current?.phase == CrashCountdownPhase.SENT) return@onMain
    update(CrashCountdown.start(suspicion, test, System.currentTimeMillis()))
    if (test) appContext.startActivity(CrashCountdownActivity.intent(appContext).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  fun startTest(context: Context) {
    start(
      context,
      CrashSuspicion(timeMillis = System.currentTimeMillis(), latitude = Double.NaN, longitude = Double.NaN, speedBefore = Double.NaN),
      test = true,
    )
  }

  fun resume(context: Context) = onMain(context) {}

  fun imOk(context: Context) = change(context) { it.imOk() }

  fun sendNow(context: Context) = change(context) { it.sendNow() }

  fun cancelIfCounting(context: Context) = change(context) { if (it.phase == CrashCountdownPhase.COUNTING) it.imOk() else it }

  fun close(context: Context) =
    onMain(context) {
      val countdown = current ?: return@onMain
      if (countdown.phase == CrashCountdownPhase.COUNTING || countdown.phase == CrashCountdownPhase.SENT) return@onMain
      current = null
      notifyListeners()
    }

  private fun change(
    context: Context,
    next: (CrashCountdown) -> CrashCountdown,
  ) = onMain(context) {
    val countdown = current
    if (countdown == null) {
      NotificationManagerCompat.from(appContext).cancel(NOTIFICATION_ID)
      return@onMain
    }
    update(next(countdown))
  }

  private fun onMain(
    context: Context,
    work: () -> Unit,
  ) {
    val run = {
      appContext = context.applicationContext
      if (current == null) restoreSaved()
      work()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) run() else handler.post(run)
  }

  private fun restoreSaved() {
    val saved = prefs().getString(COUNTDOWN_KEY, null)?.let { CrashCountdown.restore(it) } ?: return
    alertId = prefs().getString(ALERT_KEY, null)
    val restorable =
      !saved.test &&
        (saved.phase == CrashCountdownPhase.COUNTING || (saved.phase == CrashCountdownPhase.SENT && alertId != null))
    if (!restorable) {
      prefs().edit().remove(COUNTDOWN_KEY).remove(ALERT_KEY).apply()
      return
    }
    val ticked = saved.tick(System.currentTimeMillis())
    if (ticked.phase == saved.phase) update(ticked, previous = null) else update(ticked, previous = saved)
  }

  fun deliveries(context: Context): Map<String, Long?>? {
    val id = alertId ?: return null
    return TrackingRuntime.crashAlertOutbox(context).deliveries(id)
  }

  fun groupName(
    context: Context,
    groupId: String,
  ): String? =
    prefs(context).getString("groups", null)?.let { runCatching { JSONObject(it).optString(groupId) }.getOrNull() }?.takeIf { it.isNotBlank() }

  fun expireQueued(context: Context) {
    val now = System.currentTimeMillis()
    val dropped = TrackingRuntime.crashAlertOutbox(context).expire(now)
    if (dropped.isEmpty()) return
    onMain(context) {
      val countdown = current
      val crashAt = countdown?.suspicion?.timeMillis?.takeIf { alertId in dropped }
      showDroppedNotice(crashAt)
      if (alertId in dropped) end()
    }
  }

  fun onDelivered(context: Context) = onMain(context) { checkSent() }

  private fun checkSent() {
    val countdown = current ?: return
    if (countdown.phase != CrashCountdownPhase.SENT) return
    val now = System.currentTimeMillis()
    val id = alertId
    val outbox = TrackingRuntime.crashAlertOutbox(appContext)
    if (id != null && id in outbox.expire(now)) {
      showDroppedNotice(countdown.suspicion.timeMillis)
      end()
      return
    }
    val deliveries = id?.let { outbox.deliveries(it) }
    val sharingUntil = TrackingRuntime.crashSharingUntil(appContext)
    val sharingOver = sharingUntil == null || now >= sharingUntil
    if (sharingOver && sharingUntil != null) TrackingRuntime.setCrashSharingUntil(appContext, null)
    if (deliveries == null || (sharingOver && deliveries.values.none { it == null })) {
      end()
      return
    }
    refreshNotice()
    notifyListeners()
  }

  private fun end() {
    handler.removeCallbacks(sentChecker)
    current = null
    alertId = null
    prefs().edit().remove(COUNTDOWN_KEY).remove(ALERT_KEY).apply()
    refreshNotice()
    notifyListeners()
  }

  fun screenShown(
    context: Context,
    visible: Boolean,
  ) = onMain(context) {
    screenVisible = visible
    refreshNotice()
  }

  private fun refreshNotice() {
    val countdown = current
    val deliveries = alertId?.let { TrackingRuntime.crashAlertOutbox(appContext).deliveries(it) }
    val notice = CrashNoticePolicy.of(countdown, screenVisible, alertQueued = deliveries != null, anyDelivered = deliveries?.values?.any { it != null } == true)
    if (notice == CrashNotice.NONE || notice != shownNotice) NotificationManagerCompat.from(appContext).cancel(NOTIFICATION_ID)
    shownNotice = notice
    when (notice) {
      CrashNotice.NONE -> Unit
      CrashNotice.COUNTDOWN_ALARM, CrashNotice.COUNTDOWN_QUIET -> countdown?.let { showNotification(it, alarm = notice == CrashNotice.COUNTDOWN_ALARM) }
      CrashNotice.SENT, CrashNotice.NOT_SENT -> showSentNotification(sent = notice == CrashNotice.SENT)
    }
  }

  private fun onSent(countdown: CrashCountdown) {
    val now = System.currentTimeMillis()
    val deviceId = TrackingRuntime.queueDeviceId(appContext)
    val keys = readKeys().filter { it.senderDeviceId == deviceId }
    if (deviceId == null || keys.isEmpty() || TrackingRuntime.sharingState(appContext).isPaused(now)) {
      alertId = null
      return
    }
    val id = TrackingRuntime.crashAlertOutbox(appContext).queueCrash(countdown.suspicion, placeName, keys, deviceId, now)
    alertId = id
    prefs().edit().putString(ALERT_KEY, id).apply()
    TrackingRuntime.setCrashSharingUntil(appContext, CrashAlertOutbox.sharingUntil(now))
    TrackingUploadService.start(appContext, TrackingUploadService.REASON_UPLOAD)
  }

  private fun onSaidOk(countdown: CrashCountdown) {
    val id = alertId ?: return
    TrackingRuntime.crashAlertOutbox(appContext).queueOk(id, countdown.suspicion, placeName, readKeys(), System.currentTimeMillis())
    TrackingRuntime.setCrashSharingUntil(appContext, null)
    alertId = null
    prefs().edit().remove(ALERT_KEY).apply()
    TrackingUploadService.start(appContext, TrackingUploadService.REASON_UPLOAD)
  }

  private fun readKeys() =
    try {
      TrackingRuntime.epochKeyStore(appContext).list()
    } catch (error: Exception) {
      Log.w(TAG, "Couldn't read the keys for a Crash alert.", error)
      emptyList()
    }

  private fun showDroppedNotice(crashAt: Long?) {
    createDroppedChannel()
    val body =
      if (crashAt == null) {
        appContext.getString(R.string.openbeacon_crash_dropped_body_no_time)
      } else {
        appContext.getString(R.string.openbeacon_crash_dropped_body, android.text.format.DateFormat.getTimeFormat(appContext).format(java.util.Date(crashAt)))
      }
    val notification =
      NotificationCompat
        .Builder(appContext, CHANNEL_ID)
        .setGroup(GROUP)
        .setContentTitle(appContext.getString(R.string.openbeacon_crash_dropped_title))
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(0xFF2A0A0C.toInt())
        .setAutoCancel(true)
        .build()
    try {
      NotificationManagerCompat.from(appContext).notify(DROPPED_ID, notification)
    } catch (error: SecurityException) {
      Log.w(TAG, "Couldn't say the Crash alert was dropped.", error)
    }
  }

  fun addListener(listener: () -> Unit) {
    listeners += listener
  }

  fun removeListener(listener: () -> Unit) {
    listeners -= listener
  }

  fun emergencyNumber(context: Context): String {
    val telephony = context.getSystemService(TelephonyManager::class.java)
    val country = telephony?.networkCountryIso?.takeIf { it.isNotBlank() } ?: telephony?.simCountryIso
    return EmergencyNumbers.forCountry(country)
  }

  fun groupsLabel(context: Context): Pair<String, Int> {
    val names = alertGroupNames(context)
    if (names.isEmpty()) return context.getString(R.string.openbeacon_crash_your_groups) to 2
    val label =
      if (names.size == 1) {
        names.first()
      } else {
        context.getString(R.string.openbeacon_crash_and, names.dropLast(1).joinToString(", "), names.last())
      }
    return label to names.size
  }

  fun alertGroupNames(context: Context): List<String> {
    val saved = prefs(context).getString("groups", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return emptyList()
    val groupIds =
      try {
        TrackingRuntime.epochKeyStore(context).list().map { it.groupId }.distinct()
      } catch (error: Exception) {
        Log.w(TAG, "Couldn't read which groups get Crash alerts.", error)
        emptyList()
      }
    return groupIds.mapNotNull { saved.optString(it).takeIf { name -> name.isNotBlank() } }.sorted()
  }

  fun formatSpeed(
    context: Context,
    metersPerSecond: Double,
  ): String {
    val unit = prefs(context).getString("speedUnit", null) ?: if (Locale.getDefault().country.uppercase() in MPH_COUNTRIES) "mph" else "kmh"
    return if (unit == "mph") "${Math.round(metersPerSecond * 2.2369362920544)} mph" else "${Math.round(metersPerSecond * 3.6)} km/h"
  }

  fun setContext(
    context: Context,
    groups: Map<String, String>,
    speedUnit: String,
  ) {
    prefs(context).edit().putString("groups", JSONObject(groups).toString()).putString("speedUnit", speedUnit).apply()
  }

  fun openDialer(
    activity: android.app.Activity?,
    context: Context,
  ) {
    launchOverLockScreen(activity, context, Intent(Intent.ACTION_DIAL, Uri.parse("tel:${emergencyNumber(context)}")))
  }

  fun openTextMessage(
    activity: android.app.Activity?,
    context: Context,
    body: String,
  ) {
    launchOverLockScreen(activity, context, Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", body))
  }

  private fun launchOverLockScreen(
    activity: android.app.Activity?,
    context: Context,
    intent: Intent,
  ) {
    val launch = {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (error: Exception) {
        Log.w(TAG, "Couldn't open ${intent.action}.", error)
      }
    }
    val keyguard = context.getSystemService(KeyguardManager::class.java)
    if (activity != null && keyguard?.isKeyguardLocked == true) {
      keyguard.requestDismissKeyguard(
        activity,
        object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() {
            launch()
          }
        },
      )
    } else {
      launch()
    }
  }

  private fun update(
    next: CrashCountdown,
    previous: CrashCountdown? = current,
  ) {
    current = next
    if (!next.test && previous?.phase == CrashCountdownPhase.COUNTING && next.phase == CrashCountdownPhase.SENT) onSent(next)
    if (previous?.phase == CrashCountdownPhase.SENT && next.phase == CrashCountdownPhase.SAID_OK) onSaidOk(previous)
    if (placeFor != next.suspicion.timeMillis) lookUpPlace(next.suspicion)
    if ((next.phase == CrashCountdownPhase.COUNTING || (next.phase == CrashCountdownPhase.SENT && alertId != null)) && !next.test) {
      prefs().edit().putString(COUNTDOWN_KEY, next.save()).apply()
    } else {
      prefs().edit().remove(COUNTDOWN_KEY).apply()
    }
    if (next.phase == CrashCountdownPhase.COUNTING) {
      if (previous?.phase != CrashCountdownPhase.COUNTING) {
        startAlarm()
        handler.removeCallbacks(ticker)
        handler.post(ticker)
      }
    } else {
      handler.removeCallbacks(ticker)
      stopAlarm()
    }
    if (next.phase == CrashCountdownPhase.CANCELLED || next.phase == CrashCountdownPhase.SAID_OK) current = null
    refreshNotice()
    if (next.phase == CrashCountdownPhase.SENT && previous?.phase != CrashCountdownPhase.SENT) {
      handler.removeCallbacks(sentChecker)
      handler.post(sentChecker)
    }
    notifyListeners()
  }

  private fun lookUpPlace(suspicion: CrashSuspicion) {
    placeFor = suspicion.timeMillis
    placeName = null
    CrashPlaceLookup.name(appContext, suspicion.latitude, suspicion.longitude) { name ->
      if (placeFor == suspicion.timeMillis && name != null) {
        placeName = name
        notifyListeners()
      }
    }
  }

  private fun notifyListeners() {
    listeners.toList().forEach { it() }
  }

  private fun prefs(context: Context = appContext) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun startAlarm() {
    stopAlarm()
    val alarmAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ringtone =
        RingtoneManager.getRingtone(appContext, uri)?.apply {
          audioAttributes = alarmAttributes
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
          play()
        }
    } catch (error: Exception) {
      Log.w(TAG, "Couldn't play the crash alarm.", error)
    }
    try {
      vibrator =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          appContext.getSystemService(Vibrator::class.java)
        }
      val pattern = VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        vibrator?.vibrate(pattern, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
      } else {
        @Suppress("DEPRECATION")
        vibrator?.vibrate(pattern, alarmAttributes)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Couldn't vibrate for the crash alarm.", error)
    }
  }

  private fun stopAlarm() {
    ringtone?.stop()
    ringtone = null
    vibrator?.cancel()
    vibrator = null
  }

  private fun createDroppedChannel() {
    NotificationManagerCompat.from(appContext).createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(appContext.getString(R.string.openbeacon_crash_channel))
        .setDescription(appContext.getString(R.string.openbeacon_crash_channel_description))
        .setSound(null, null)
        .setVibrationEnabled(false)
        .setShowBadge(false)
        .build(),
    )
  }

  private fun createQuietChannel() {
    NotificationManagerCompat.from(appContext).createNotificationChannel(
      NotificationChannelCompat
        .Builder(QUIET_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(appContext.getString(R.string.openbeacon_crash_channel))
        .setDescription(appContext.getString(R.string.openbeacon_crash_channel_description))
        .setShowBadge(false)
        .build(),
    )
  }

  private fun openScreen() =
    PendingIntent.getActivity(
      appContext,
      NOTIFICATION_ID,
      CrashCountdownActivity.intent(appContext).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun callIntent() =
    PendingIntent.getActivity(
      appContext,
      NOTIFICATION_ID + 1,
      Intent(Intent.ACTION_DIAL, Uri.parse("tel:${emergencyNumber(appContext)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun showSentNotification(sent: Boolean) {
    createQuietChannel()
    val sharingUntil = TrackingRuntime.crashSharingUntil(appContext)
    val body =
      when {
        !sent -> appContext.getString(R.string.openbeacon_crash_not_sent_body)
        sharingUntil != null && sharingUntil > System.currentTimeMillis() ->
          appContext.getString(R.string.openbeacon_crash_sent_body, android.text.format.DateFormat.getTimeFormat(appContext).format(java.util.Date(sharingUntil)))
        else -> appContext.getString(R.string.openbeacon_crash_ok_tell_caption, groupsLabel(appContext).first.replaceFirstChar { it.titlecase(Locale.getDefault()) })
      }
    val builder =
      NotificationCompat
        .Builder(appContext, QUIET_CHANNEL_ID)
        .setGroup(GROUP)
        .setContentTitle(appContext.getString(if (sent) R.string.openbeacon_crash_sent_title else R.string.openbeacon_crash_not_sent_title))
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(0xFF2A0A0C.toInt())
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openScreen())
        .addAction(0, appContext.getString(if (sent) R.string.openbeacon_crash_ok_tell else R.string.openbeacon_crash_im_ok), CrashCountdownReceiver.intent(appContext, CrashCountdownReceiver.ACTION_IM_OK))
    if (!sent) builder.addAction(0, appContext.getString(R.string.openbeacon_crash_call, emergencyNumber(appContext)), callIntent())
    try {
      NotificationManagerCompat.from(appContext).notify(NOTIFICATION_ID, builder.build())
    } catch (error: SecurityException) {
      Log.w(TAG, "Couldn't show the Crash alert status.", error)
    }
  }

  private fun showNotification(
    countdown: CrashCountdown,
    alarm: Boolean,
  ) {
    createQuietChannel()
    val manager = NotificationManagerCompat.from(appContext)
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(appContext.getString(R.string.openbeacon_crash_channel))
        .setDescription(appContext.getString(R.string.openbeacon_crash_channel_description))
        .setSound(null, null)
        .setVibrationEnabled(false)
        .setShowBadge(false)
        .build(),
    )
    val open = openScreen()
    val seconds = countdown.secondsLeft(System.currentTimeMillis())
    val groups = groupsLabel(appContext).first
    val body =
      if (countdown.test) {
        appContext.getString(R.string.openbeacon_crash_notification_test_body)
      } else {
        appContext.getString(R.string.openbeacon_crash_notification_body, groups)
      }
    val builder =
      NotificationCompat
        .Builder(appContext, if (alarm) CHANNEL_ID else QUIET_CHANNEL_ID)
        .setGroup(GROUP)
        .setContentTitle(
          appContext.getString(
            if (countdown.test) R.string.openbeacon_crash_notification_test_title else R.string.openbeacon_crash_notification_title,
            seconds,
          ),
        ).setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(0xFFB3261E.toInt())
        .setColorized(true)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setContentIntent(open)
        .addAction(0, appContext.getString(R.string.openbeacon_crash_im_ok), CrashCountdownReceiver.intent(appContext, CrashCountdownReceiver.ACTION_IM_OK))
        .addAction(0, appContext.getString(R.string.openbeacon_crash_send_now), CrashCountdownReceiver.intent(appContext, CrashCountdownReceiver.ACTION_SEND_NOW))
    if (!countdown.test) {
      builder.addAction(
        0,
        appContext.getString(R.string.openbeacon_crash_call, emergencyNumber(appContext)),
        callIntent(),
      )
    }
    if (alarm && canUseFullScreenIntent()) builder.setFullScreenIntent(open, true)
    try {
      manager.notify(NOTIFICATION_ID, builder.build())
    } catch (error: SecurityException) {
      Log.w(TAG, "Couldn't show the crash countdown notification.", error)
    }
  }

  private fun canUseFullScreenIntent(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      appContext.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true
}
