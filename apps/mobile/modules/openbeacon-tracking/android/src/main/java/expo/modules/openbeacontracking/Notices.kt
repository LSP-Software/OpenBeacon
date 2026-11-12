package expo.modules.openbeacontracking

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notices {
  const val LOCATION_PERMISSION = "locationPermission"
  const val SHARING_RESUMED = "sharingResumed"
  const val SHARING_CHANGED = "sharingChanged"

  const val SLOT_COMPATIBILITY = "compatibility"
  const val SLOT_LOCATION_PERMISSION = "locationPermission"
  const val SLOT_SIGNED_OUT = "signedOut"
  const val SLOT_SHARING_CHANGED = "sharingChanged"

  private const val CHANNEL_ID = "openbeacon_sharing_alerts"
  private const val OLD_COMPATIBILITY_CHANNEL_ID = "openbeacon_app_compatibility"

  private val slotIds =
    mapOf(
      SLOT_COMPATIBILITY to 7261,
      SLOT_SHARING_CHANGED to 7262,
      SLOT_LOCATION_PERMISSION to 7263,
      SLOT_SIGNED_OUT to 7264,
    )

  private data class Notice(
    val slot: String,
    val title: Int,
    val body: Int,
    val link: String? = null,
  )

  private val notices =
    mapOf(
      "appTooOld" to Notice(SLOT_COMPATIBILITY, R.string.openbeacon_notice_app_too_old_title, R.string.openbeacon_notice_app_too_old_body),
      "serverTooOld" to Notice(SLOT_COMPATIBILITY, R.string.openbeacon_notice_sharing_paused_title, R.string.openbeacon_notice_server_updating_body),
      "selfHostedServerTooOld" to Notice(SLOT_COMPATIBILITY, R.string.openbeacon_notice_sharing_paused_title, R.string.openbeacon_notice_self_hosted_server_too_old_body),
      "outOfSync" to Notice(SLOT_COMPATIBILITY, R.string.openbeacon_notice_sharing_paused_title, R.string.openbeacon_notice_out_of_sync_body),
      LOCATION_PERMISSION to
        Notice(SLOT_LOCATION_PERMISSION, R.string.openbeacon_notice_location_permission_title, R.string.openbeacon_notice_location_permission_body, "openbeacon:///account/overview"),
      "deviceRemoved" to Notice(SLOT_SIGNED_OUT, R.string.openbeacon_notice_signed_out_title, R.string.openbeacon_notice_device_removed_body),
      "signedOut" to Notice(SLOT_SIGNED_OUT, R.string.openbeacon_notice_signed_out_title, R.string.openbeacon_notice_signed_out_body),
      SHARING_RESUMED to Notice(SLOT_SHARING_CHANGED, R.string.openbeacon_notice_sharing_resumed_title, R.string.openbeacon_notice_sharing_resumed_body),
      SHARING_CHANGED to Notice(SLOT_SHARING_CHANGED, R.string.openbeacon_notice_sharing_changed_title, R.string.openbeacon_notice_sharing_changed_body),
    )

  fun areEnabled(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      (
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
          ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      )

  fun show(
    context: Context,
    kind: String,
  ): Boolean {
    val notice = notices[kind] ?: throw IllegalArgumentException("Unknown notice $kind.")
    if (!areEnabled(context)) return false
    val manager = NotificationManagerCompat.from(context)
    manager.deleteNotificationChannel(OLD_COMPATIBILITY_CHANNEL_ID)
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(context.getString(R.string.openbeacon_notice_channel))
        .setDescription(context.getString(R.string.openbeacon_notice_channel_description))
        .setShowBadge(false)
        .build(),
    )
    val id = slotIds.getValue(notice.slot)
    val body = context.getString(notice.body)
    val intent =
      notice.link?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it)).setPackage(context.packageName) }
        ?: context.packageManager.getLaunchIntentForPackage(context.packageName)
    manager.notify(
      id,
      NotificationCompat
        .Builder(context, CHANNEL_ID)
        .setContentTitle(context.getString(notice.title))
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(ContextCompat.getColor(context, R.color.openbeacon_notification_color))
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setOnlyAlertOnce(true)
        .setAutoCancel(true)
        .setContentIntent(intent?.let { PendingIntent.getActivity(context, id, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) })
        .build(),
    )
    return true
  }

  fun dismiss(
    context: Context,
    slot: String,
  ) {
    val id = slotIds[slot] ?: throw IllegalArgumentException("Unknown notice slot $slot.")
    NotificationManagerCompat.from(context).cancel(id)
  }
}
