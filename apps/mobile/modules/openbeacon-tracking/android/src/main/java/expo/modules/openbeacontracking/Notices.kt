package expo.modules.openbeacontracking

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.annotation.StringRes
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.capture.TrackingCaptureService

enum class NoticeSlot(
  val key: String,
  val id: Int,
) {
  COMPATIBILITY("compatibility", 7261),
  SHARING_CHANGED("sharingChanged", 7262),
  LOCATION_PERMISSION("locationPermission", 7263),
  SIGNED_OUT("signedOut", 7264),
  ;

  companion object {
    fun of(key: String) = entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("Unknown notice slot $key.")
  }
}

enum class Notice(
  val kind: String,
  val slot: NoticeSlot,
  @StringRes val title: Int,
  @StringRes val body: Int,
  val link: String? = null,
) {
  APP_TOO_OLD("appTooOld", NoticeSlot.COMPATIBILITY, R.string.openbeacon_notice_app_too_old_title, R.string.openbeacon_notice_app_too_old_body),
  SERVER_TOO_OLD("serverTooOld", NoticeSlot.COMPATIBILITY, R.string.openbeacon_notice_sharing_paused_title, R.string.openbeacon_notice_server_updating_body),
  SELF_HOSTED_SERVER_TOO_OLD(
    "selfHostedServerTooOld",
    NoticeSlot.COMPATIBILITY,
    R.string.openbeacon_notice_sharing_paused_title,
    R.string.openbeacon_notice_self_hosted_server_too_old_body,
  ),
  OUT_OF_SYNC("outOfSync", NoticeSlot.COMPATIBILITY, R.string.openbeacon_notice_sharing_paused_title, R.string.openbeacon_notice_out_of_sync_body),
  LOCATION_PERMISSION(
    "locationPermission",
    NoticeSlot.LOCATION_PERMISSION,
    R.string.openbeacon_notice_location_permission_title,
    R.string.openbeacon_notice_location_permission_body,
    "openbeacon:///account/overview",
  ),
  DEVICE_REMOVED("deviceRemoved", NoticeSlot.SIGNED_OUT, R.string.openbeacon_notice_signed_out_title, R.string.openbeacon_notice_device_removed_body),
  SIGNED_OUT("signedOut", NoticeSlot.SIGNED_OUT, R.string.openbeacon_notice_signed_out_title, R.string.openbeacon_notice_signed_out_body),
  SHARING_RESUMED("sharingResumed", NoticeSlot.SHARING_CHANGED, R.string.openbeacon_notice_sharing_resumed_title, R.string.openbeacon_notice_sharing_resumed_body),
  SHARING_CHANGED("sharingChanged", NoticeSlot.SHARING_CHANGED, R.string.openbeacon_notice_sharing_changed_title, R.string.openbeacon_notice_sharing_changed_body),
  ;

  companion object {
    fun of(kind: String) = entries.firstOrNull { it.kind == kind } ?: throw IllegalArgumentException("Unknown notice $kind.")
  }
}

object Notices {
  private const val CHANNEL_ID = "openbeacon_sharing_alerts"

  fun removeOldChannels(context: Context) {
    NotificationManagerCompat.from(context).deleteNotificationChannel("openbeacon_app_compatibility")
  }

  fun areEnabled(context: Context): Boolean {
    val manager = NotificationManagerCompat.from(context)
    return manager.areNotificationsEnabled() &&
      manager.getNotificationChannelCompat(CHANNEL_ID)?.importance != NotificationManagerCompat.IMPORTANCE_NONE &&
      (
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
          ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      )
  }

  fun canShowSharing(context: Context): Boolean =
    areEnabled(context) &&
      NotificationManagerCompat.from(context).getNotificationChannelCompat(TrackingCaptureService.CHANNEL_ID)?.importance !=
      NotificationManagerCompat.IMPORTANCE_NONE

  fun show(
    context: Context,
    notice: Notice,
  ): Boolean {
    if (!areEnabled(context)) return false
    val alerted = context.getSharedPreferences("openbeacon_notices", Context.MODE_PRIVATE)
    if (notice == Notice.LOCATION_PERMISSION && alerted.getBoolean(notice.kind, false)) return true
    val manager = NotificationManagerCompat.from(context)
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(context.getString(R.string.openbeacon_notice_channel))
        .setDescription(context.getString(R.string.openbeacon_notice_channel_description))
        .setShowBadge(false)
        .build(),
    )
    val id = notice.slot.id
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
    if (notice == Notice.LOCATION_PERMISSION) alerted.edit().putBoolean(notice.kind, true).apply()
    return true
  }

  fun dismiss(
    context: Context,
    slot: NoticeSlot,
  ) {
    NotificationManagerCompat.from(context).cancel(slot.id)
    if (slot == NoticeSlot.LOCATION_PERMISSION) {
      context.getSharedPreferences("openbeacon_notices", Context.MODE_PRIVATE).edit().remove(Notice.LOCATION_PERMISSION.kind).apply()
    }
  }
}
