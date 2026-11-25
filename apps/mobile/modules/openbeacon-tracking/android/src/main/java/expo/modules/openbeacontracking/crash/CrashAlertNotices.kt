package expo.modules.openbeacontracking.crash

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.openbeacontracking.R

object CrashAlertNotices {
  const val TAG = "openbeacon_crash_alert"
  private const val ALERT_CHANNEL = "openbeacon_crash_alerts"
  private const val OK_CHANNEL = "openbeacon_crash_alert_follow_ups"
  private const val GROUP = "openbeacon_crash_alerts"

  private fun createChannels(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    val alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(ALERT_CHANNEL, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(context.getString(R.string.openbeacon_crash_alerts_channel))
        .setDescription(context.getString(R.string.openbeacon_crash_alerts_channel_description))
        .setSound(alarm, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        .setVibrationEnabled(true)
        .setVibrationPattern(longArrayOf(0, 800, 400, 800, 400, 800))
        .build(),
    )
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(OK_CHANNEL, NotificationManagerCompat.IMPORTANCE_DEFAULT)
        .setName(context.getString(R.string.openbeacon_crash_alerts_ok_channel))
        .setDescription(context.getString(R.string.openbeacon_crash_alerts_ok_channel_description))
        .build(),
    )
  }

  fun show(
    context: Context,
    ok: Boolean,
    key: String,
    title: String,
    body: String,
    link: String,
  ): Boolean {
    createChannels(context)
    val open =
      PendingIntent.getActivity(
        context,
        key.hashCode(),
        Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val builder =
      NotificationCompat
        .Builder(context, if (ok) OK_CHANNEL else ALERT_CHANNEL)
        .setGroup(GROUP)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(if (ok) 0xFF1E6B3A.toInt() else 0xFFB3261E.toInt())
        .setAutoCancel(true)
        .setContentIntent(open)
        .setCategory(if (ok) NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_ALARM)
        .setPriority(if (ok) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
    if (!ok) builder.addAction(0, context.getString(R.string.openbeacon_crash_show_on_map), open)
    return try {
      NotificationManagerCompat.from(context).notify(TAG, key.hashCode(), builder.build())
      true
    } catch (error: SecurityException) {
      Log.w("CrashAlerts", "Couldn't show a Crash alert.", error)
      false
    }
  }

  fun clear(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    manager.activeNotifications.filter { it.tag == TAG }.forEach { manager.cancel(it.tag, it.id) }
  }

  fun soundsDuringDoNotDisturb(context: Context): Boolean? {
    createChannels(context)
    return context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(ALERT_CHANNEL)?.canBypassDnd()
  }

  fun openSoundSettings(context: Context) {
    createChannels(context)
    val intent =
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, ALERT_CHANNEL)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (error: Exception) {
      Log.w("CrashAlerts", "Couldn't open the Crash alerts sound settings.", error)
    }
  }
}
