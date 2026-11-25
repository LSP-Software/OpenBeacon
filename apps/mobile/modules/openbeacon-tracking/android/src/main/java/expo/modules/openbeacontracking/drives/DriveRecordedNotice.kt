package expo.modules.openbeacontracking.drives

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.R
import expo.modules.openbeacontracking.crypto.DriveRecord
import java.util.Locale
import kotlin.math.roundToInt

object DriveRecordedNotice {
  private const val CHANNEL_ID = "openbeacon_drive_recorded"
  private const val TAG = "openbeacon_drive_recorded"
  private const val PREFERENCES = "openbeacon_drive_alerts"
  private val MILE_REGIONS = setOf("AG", "AI", "AS", "BS", "BZ", "DM", "FK", "GB", "GD", "GG", "GU", "IM", "JE", "KN", "KY", "LC", "LR", "MP", "MS", "PR", "SH", "TC", "UM", "US", "VC", "VG", "VI", "WS")

  fun isOn(context: Context): Boolean = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean("recordedNotice", true)

  fun setOn(
    context: Context,
    on: Boolean,
  ) {
    check(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean("recordedNotice", on).commit())
  }

  fun setDistanceUnit(
    context: Context,
    unit: String,
  ) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString("distanceUnit", unit).apply()
  }

  fun formatDistance(
    meters: Double,
    unit: String,
  ): String {
    if (unit == "km" && meters.roundToInt() < 1000) return "${meters.roundToInt()} m"
    if (unit == "mi" && (meters * 3.28084).roundToInt() < 528) return "${(meters * 3.28084).roundToInt()} ft"
    val value = if (unit == "km") meters / 1000 else meters / 1609.344
    val shown = if (value < 99.95) String.format(Locale.ROOT, "%.1f", value) else value.roundToInt().toString()
    return "$shown $unit"
  }

  fun show(
    context: Context,
    record: DriveRecord,
    groupIds: List<String>,
  ) {
    val groupId = groupIds.firstOrNull() ?: return
    if (!isOn(context)) return
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    manager.createNotificationChannel(
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(context.getString(R.string.openbeacon_drive_recorded_channel))
        .setDescription(context.getString(R.string.openbeacon_drive_recorded_channel_description))
        .setShowBadge(false)
        .build(),
    )
    val unit =
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("distanceUnit", null)
        ?: if (Locale.getDefault().country in MILE_REGIONS) "mi" else "km"
    val link = "openbeacon:///timeline?groupId=${Uri.encode(groupId)}&driveId=${Uri.encode(record.driveId)}"
    val open = { url: String, code: Int ->
      PendingIntent.getActivity(
        context,
        code,
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
    val id = record.driveId.hashCode()
    manager.notify(
      TAG,
      id,
      NotificationCompat
        .Builder(context, CHANNEL_ID)
        .setContentTitle(context.getString(R.string.openbeacon_drive_recorded_title, formatDistance(record.distanceMeters, unit)))
        .setContentText(context.getString(R.string.openbeacon_drive_recorded_body))
        .setSmallIcon(R.drawable.openbeacon_notification_icon)
        .setColor(ContextCompat.getColor(context, R.color.openbeacon_notification_color))
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setOnlyAlertOnce(true)
        .setAutoCancel(true)
        .setContentIntent(open(link, id))
        .addAction(
          R.drawable.openbeacon_notification_icon,
          context.getString(R.string.openbeacon_drive_recorded_passenger),
          open("$link&passenger=1", id + 1),
        ).build(),
    )
  }
}
