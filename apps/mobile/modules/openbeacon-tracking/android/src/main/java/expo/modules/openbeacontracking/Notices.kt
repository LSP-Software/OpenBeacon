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

enum class EventNoticeKind(
  val kind: String,
  val tag: String,
  val channel: EventChannel?,
) {
  ALERT("alert", "openbeacon_place_alert", EventChannel.PLACE_ALERTS),
  PLACES_CHANGED("placesChanged", "openbeacon_places_changed", null),
  GROUP_ACTIVITY("groupActivity", "openbeacon_group_activity", EventChannel.GROUP_ACTIVITY),
  ACCOUNT_ALERT("accountAlert", "openbeacon_account_alert", EventChannel.ACCOUNT_ALERTS),
  ;

  companion object {
    fun of(kind: String) = entries.firstOrNull { it.kind == kind } ?: throw IllegalArgumentException("Unknown event notice $kind.")
  }
}

enum class EventChannel(
  val id: String,
  @StringRes val title: Int,
  @StringRes val description: Int,
  val importance: Int,
) {
  PLACE_ALERTS(
    "openbeacon_place_alerts",
    R.string.openbeacon_place_alerts_channel,
    R.string.openbeacon_place_alerts_channel_description,
    NotificationManagerCompat.IMPORTANCE_DEFAULT,
  ),
  GROUP_ACTIVITY(
    "openbeacon_group_activity",
    R.string.openbeacon_group_activity_channel,
    R.string.openbeacon_group_activity_channel_description,
    NotificationManagerCompat.IMPORTANCE_DEFAULT,
  ),
  ACCOUNT_ALERTS(
    "openbeacon_account_alerts",
    R.string.openbeacon_account_alerts_channel,
    R.string.openbeacon_account_alerts_channel_description,
    NotificationManagerCompat.IMPORTANCE_HIGH,
  ),
}

object Notices {
  private const val CHANNEL_ID = "openbeacon_sharing_alerts"

  fun removeOldChannels(context: Context) {
    NotificationManagerCompat.from(context).deleteNotificationChannel("openbeacon_app_compatibility")
  }

  fun areEnabled(context: Context): Boolean = isChannelEnabled(context, CHANNEL_ID)

  private fun isChannelEnabled(
    context: Context,
    channelId: String,
  ): Boolean {
    val manager = NotificationManagerCompat.from(context)
    return manager.areNotificationsEnabled() &&
      manager.getNotificationChannelCompat(channelId)?.importance != NotificationManagerCompat.IMPORTANCE_NONE &&
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
    createSharingChannel(context)
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

  fun showEvent(
    context: Context,
    kind: EventNoticeKind,
    key: String,
    title: String,
    body: String?,
    groupName: String?,
    link: String,
  ): Boolean {
    val manager = NotificationManagerCompat.from(context)
    val channelId =
      kind.channel?.let { channel ->
        manager.createNotificationChannel(
          NotificationChannelCompat
            .Builder(channel.id, channel.importance)
            .setName(context.getString(channel.title))
            .setDescription(context.getString(channel.description))
            .build(),
        )
        channel.id
      } ?: run {
        createSharingChannel(context)
        CHANNEL_ID
      }
    if (!isChannelEnabled(context, channelId)) return false
    val id = key.hashCode()
    val intent =
      PendingIntent.getActivity(
        context,
        id,
        Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val builder =
      NotificationCompat
        .Builder(context, channelId)
        .setContentTitle(title)
        .setSubText(groupName)
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(ContextCompat.getColor(context, R.color.openbeacon_notification_color))
        .setCategory(if (kind == EventNoticeKind.PLACES_CHANGED) NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_EVENT)
        .setOnlyAlertOnce(true)
        .setAutoCancel(true)
        .setContentIntent(intent)
    if (body != null) builder.setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
    if (kind == EventNoticeKind.PLACES_CHANGED) builder.addAction(0, context.getString(R.string.openbeacon_places_changed_manage), intent)
    manager.notify(kind.tag, id, builder.build())
    return true
  }

  private fun createSharingChannel(context: Context) {
    NotificationManagerCompat.from(context).createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
        .setName(context.getString(R.string.openbeacon_notice_channel))
        .setDescription(context.getString(R.string.openbeacon_notice_channel_description))
        .setShowBadge(false)
        .build(),
    )
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
