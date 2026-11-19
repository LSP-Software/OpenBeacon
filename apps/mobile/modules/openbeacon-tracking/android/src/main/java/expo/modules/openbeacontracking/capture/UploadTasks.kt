package expo.modules.openbeacontracking.capture

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID

object UploadTasks {
  const val NAME = "OpenBeaconTrackingUpload"
  const val TIMEOUT_MS = 60_000L
  const val EXTRA_TOKEN = "taskToken"
  private val running = mutableMapOf<String, Pair<HeadlessJsTaskContext, Int>>()

  var isStartingDirectly = false
    private set

  fun start(tasks: HeadlessJsTaskContext, data: WritableMap): Int {
    val token = UUID.randomUUID().toString()
    data.putString(EXTRA_TOKEN, token)
    isStartingDirectly = true
    val taskId =
      try {
        tasks.startTask(HeadlessJsTaskConfig(NAME, data, TIMEOUT_MS, true))
      } finally {
        isStartingDirectly = false
      }
    register(token, tasks, taskId)
    return taskId
  }

  fun register(token: String, tasks: HeadlessJsTaskContext, taskId: Int) {
    running.entries.removeAll { (_, task) -> !task.first.isTaskRunning(task.second) }
    running[token] = tasks to taskId
  }

  // React Native 0.83 never registers HeadlessJsTaskSupport, so JS can't finish its own task and every task would run to its timeout.
  fun finish(token: String) {
    Handler(Looper.getMainLooper()).post {
      val (tasks, taskId) = running.remove(token) ?: return@post
      if (tasks.isTaskRunning(taskId)) tasks.finishTask(taskId)
    }
  }
}
