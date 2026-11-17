package expo.modules.openbeacontracking.push

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.openbeacontracking.capture.TrackingUploadService

object PushRuntime {
  private const val TAG = "PushRuntime"

  @Volatile
  private var tokens: PushTokens? = null

  fun tokens(context: Context): PushTokens {
    tokens?.let { return it }
    return synchronized(this) {
      tokens ?: PushTokens(SecurePushTokenStore(context.applicationContext), System::currentTimeMillis).also { tokens = it }
    }
  }

  @Synchronized
  fun initialize(context: Context): Boolean {
    if (FirebaseApp.getApps(context).isNotEmpty()) return true
    val options = options(context) ?: return false
    return try {
      FirebaseApp.initializeApp(context.applicationContext, options)
      true
    } catch (error: RuntimeException) {
      Log.e(TAG, "Failed to start Firebase, so push is off.", error)
      false
    }
  }

  fun confirm(context: Context, scope: String, sent: String?, pushAvailable: Boolean) {
    val requested = tokens(context).confirm(scope, sent, pushAvailable) ?: return
    if (!initialize(context)) return
    val messaging = FirebaseMessaging.getInstance()
    messaging.isAutoInitEnabled = true
    messaging.token.addOnCompleteListener { task ->
      val token = if (task.isSuccessful) task.result else null
      if (token.isNullOrEmpty()) {
        Log.w(TAG, "Couldn't get a push token, so push is off for now.", task.exception)
        return@addOnCompleteListener
      }
      receive(context, token, requested)
    }
  }

  fun receive(context: Context, token: String, requested: Long? = null) {
    if (tokens(context).receive(token, requested)) TrackingUploadService.start(context, TrackingUploadService.REASON_PUSH)
  }

  fun forget(context: Context, scope: String): Boolean {
    val forgotten = tokens(context).forget(scope)
    if (forgotten.deleteToken && initialize(context)) {
      val messaging = FirebaseMessaging.getInstance()
      messaging.isAutoInitEnabled = false
      messaging.deleteToken().addOnFailureListener { error -> Log.w(TAG, "Couldn't delete the push token.", error) }
    }
    return forgotten.clearOnServer
  }

  private fun options(context: Context): FirebaseOptions? {
    val value = { name: String ->
      context.resources
        .getIdentifier(name, "string", context.packageName)
        .takeIf { it != 0 }
        ?.let { context.getString(it) }
        ?.takeIf { it.isNotBlank() }
    }
    return FirebaseOptions
      .Builder()
      .setApplicationId(value("openbeacon_firebase_app_id") ?: return null)
      .setApiKey(value("openbeacon_firebase_api_key") ?: return null)
      .setProjectId(value("openbeacon_firebase_project_id") ?: return null)
      .setGcmSenderId(value("openbeacon_firebase_sender_id") ?: return null)
      .build()
  }
}
