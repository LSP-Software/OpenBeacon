package expo.modules.openbeacontracking.capture

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

class TrackingUploadService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    live = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val token = wakes.accept(intent?.getStringExtra(EXTRA_REASON) == REASON_PUSH) ?: return START_NOT_STICKY
    return super.onStartCommand((intent ?: Intent()).putExtra(EXTRA_TASK_TOKEN, token), flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      "OpenBeaconTrackingUpload",
      Arguments.createMap().apply {
        putString("reason", intent?.getStringExtra(EXTRA_REASON) ?: "upload")
        putString("taskToken", intent?.getStringExtra(EXTRA_TASK_TOKEN))
      },
      60_000,
      true,
    )

  override fun onHeadlessJsTaskStart(taskId: Int) {
    wakes.started(taskId)
    super.onHeadlessJsTaskStart(taskId)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    val followUp = wakes.finished(taskId)
    super.onHeadlessJsTaskFinish(taskId)
    if (followUp) startFollowUp()
  }

  override fun onDestroy() {
    if (live === this) live = null
    super.onDestroy()
    if (wakes.stopped()) startFollowUp()
  }

  private fun finishTask(token: String) {
    val taskId = wakes.taskFor(token) ?: return
    val tasks = HeadlessJsTaskContext.getInstance(reactContext ?: return)
    if (tasks.isTaskRunning(taskId)) tasks.finishTask(taskId)
  }

  private fun startFollowUp() {
    val context = applicationContext
    Handler(Looper.getMainLooper()).post { start(context, REASON_PUSH) }
  }

  companion object {
    const val EXTRA_REASON = "reason"
    const val REASON_PUSH = "push"
    private const val EXTRA_TASK_TOKEN = "taskToken"
    private val wakes = UploadWakeGate()
    private var live: TrackingUploadService? = null

    // React Native 0.83 never registers HeadlessJsTaskSupport, so JS can't finish its own task and every upload would run to its timeout.
    fun finish(token: String) {
      Handler(Looper.getMainLooper()).post { live?.finishTask(token) }
    }

    fun start(context: Context, reason: String) {
      try {
        context.startService(Intent(context, TrackingUploadService::class.java).putExtra(EXTRA_REASON, reason))
      } catch (error: IllegalStateException) {
        Log.w("TrackingUploadService", "Android didn't allow the upload to start in the background.", error)
      }
    }
  }
}
