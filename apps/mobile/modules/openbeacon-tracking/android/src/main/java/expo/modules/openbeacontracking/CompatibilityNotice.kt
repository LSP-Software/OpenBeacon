package expo.modules.openbeacontracking

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object CompatibilityNotice {
  private const val CHANNEL_ID = "openbeacon_app_compatibility"
  private const val NOTIFICATION_ID = 7261

  fun show(
    context: Context,
    title: String,
    body: String,
  ): Boolean {
    val manager = NotificationManagerCompat.from(context)
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    if (!manager.areNotificationsEnabled()) {
      return false
    }

    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
        .setName(context.getString(R.string.openbeacon_compatibility_notification_channel))
        .build(),
    )
    val launchIntent =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { intent ->
        PendingIntent.getActivity(
          context,
          NOTIFICATION_ID,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }
    val notification =
      NotificationCompat
        .Builder(context, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(android.R.drawable.stat_notify_error)
        .setAutoCancel(true)
        .setContentIntent(launchIntent)
        .build()
    manager.notify(NOTIFICATION_ID, notification)
    return true
  }

  fun clear(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }
}
