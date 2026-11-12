package expo.modules.openbeacontracking.capture

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import expo.modules.openbeacontracking.Notice
import expo.modules.openbeacontracking.Notices
import expo.modules.openbeacontracking.TrackingRuntime
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class SharingResumeWorker(
  context: Context,
  parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    if (TrackingRuntime.isCaptureParked(applicationContext)) syncSharing()
    restoreCapture(applicationContext)
    return Result.success()
  }

  private suspend fun syncSharing() {
    val host = (applicationContext as? ReactApplication)?.reactHost ?: return
    withContext(Dispatchers.Main) {
      withTimeoutOrNull(SYNC_TIMEOUT_MS) {
        val reactContext =
          host.currentReactContext ?: suspendCancellableCoroutine { continuation ->
            val listener =
              object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) {
                  host.removeReactInstanceEventListener(this)
                  continuation.resume(context)
                }
              }
            host.addReactInstanceEventListener(listener)
            continuation.invokeOnCancellation { host.removeReactInstanceEventListener(listener) }
            host.start()
          }
        val tasks = HeadlessJsTaskContext.getInstance(reactContext)
        suspendCancellableCoroutine { continuation ->
          var taskId: Int? = null
          val listener =
            object : HeadlessJsTaskEventListener {
              override fun onHeadlessJsTaskStart(taskId: Int) = Unit

              override fun onHeadlessJsTaskFinish(finishedTaskId: Int) {
                if (finishedTaskId != taskId) return
                tasks.removeTaskEventListener(this)
                continuation.resume(Unit)
              }
            }
          tasks.addTaskEventListener(listener)
          continuation.invokeOnCancellation { tasks.removeTaskEventListener(listener) }
          try {
            taskId = tasks.startTask(HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), TASK_TIMEOUT_MS, true))
          } catch (error: RuntimeException) {
            Log.e(TAG, "Failed to check location sharing preferences.", error)
            tasks.removeTaskEventListener(listener)
            continuation.resume(Unit)
          }
        }
      }
    }
  }

  companion object {
    private const val TAG = "SharingResumeWorker"
    const val WORK_NAME = "openbeacon_sharing_resume_check"
    private const val TASK_NAME = "OpenBeaconTrackingUpload"
    private const val TASK_TIMEOUT_MS = 60_000L
    private const val SYNC_TIMEOUT_MS = 90_000L

    fun schedule(context: Context) {
      try {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
          WORK_NAME,
          ExistingPeriodicWorkPolicy.KEEP,
          PeriodicWorkRequestBuilder<SharingResumeWorker>(15, TimeUnit.MINUTES)
            .setInitialDelay(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build(),
        )
      } catch (error: IllegalStateException) {
        Log.e(TAG, "Failed to schedule the location sharing check.", error)
      }
    }

    fun cancel(context: Context) {
      try {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
      } catch (error: IllegalStateException) {
        Log.e(TAG, "Failed to cancel the location sharing check.", error)
      }
    }

    fun restoreCapture(context: Context) {
      val sharing =
        synchronized(TrackingRuntime.captureLock) {
          when {
            TrackingRuntime.isCaptureParked(context) -> return
            TrackingRuntime.isCaptureRunning || !TrackingRuntime.isCaptureEnabled(context) -> null
            else -> TrackingRuntime.sharingState(context)
          }
        }
      if (sharing != null && TrackingRuntime.shouldRestoreCapture(context) && startCaptureService(context)) return
      if (sharing != null) showNotice(context)
      cancel(context)
    }

    private fun startCaptureService(context: Context): Boolean =
      try {
        ContextCompat.startForegroundService(
          context,
          Intent(context, TrackingCaptureService::class.java).putExtra(TrackingCaptureService.EXTRA_RESUMING_SHARING, true),
        )
        true
      } catch (error: IllegalStateException) {
        Log.w(TAG, "Android didn't allow location capture to restart in the background.", error)
        false
      } catch (error: SecurityException) {
        Log.e(TAG, "Failed to restart location capture.", error)
        false
      }

    fun showNotice(context: Context) {
      Notices.show(
        context,
        when {
          TrackingRuntime.hasLostLocationPermission(context) -> Notice.LOCATION_PERMISSION
          TrackingRuntime.sharingState(context).isPaused(System.currentTimeMillis()) -> Notice.SHARING_CHANGED
          else -> Notice.SHARING_RESUMED
        },
      )
    }
  }
}
