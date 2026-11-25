package expo.modules.openbeacontracking

import android.app.Activity
import android.content.Context
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

object AppUpdate {
  fun check(context: Context, finish: (Map<String, Any?>) -> Unit) {
    AppUpdateManagerFactory.create(context).appUpdateInfo
      .addOnSuccessListener { finish(describe(it)) }
      .addOnFailureListener { finish(mapOf("status" to "none")) }
  }

  fun start(activity: Activity, finish: (String) -> Unit) {
    val manager = AppUpdateManagerFactory.create(activity)
    manager.appUpdateInfo
      .addOnSuccessListener { info ->
        if (describe(info)["status"] == "none") {
          finish("failed")
          return@addOnSuccessListener
        }
        manager.startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
          .addOnSuccessListener {
            finish(
              when (it) {
                Activity.RESULT_OK -> "started"
                Activity.RESULT_CANCELED -> "cancelled"
                else -> "failed"
              },
            )
          }
          .addOnFailureListener { finish("failed") }
      }
      .addOnFailureListener { finish("failed") }
  }

  private fun describe(info: AppUpdateInfo): Map<String, Any?> {
    val status =
      when {
        info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> "inProgress"
        info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
          info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) -> "available"
        else -> return mapOf("status" to "none")
      }
    return mapOf("status" to status, "versionCode" to info.availableVersionCode().toDouble())
  }
}
