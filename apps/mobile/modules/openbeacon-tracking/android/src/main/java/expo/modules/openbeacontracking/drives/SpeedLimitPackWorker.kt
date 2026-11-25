package expo.modules.openbeacontracking.drives

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import expo.modules.openbeacontracking.TrackingRuntime

class SpeedLimitPackWorker(
  context: Context,
  parameters: WorkerParameters,
) : Worker(context, parameters) {
  override fun doWork(): Result {
    val request =
      PackRequest(
        regionId = inputData.getString(REGION_ID) ?: return Result.success(),
        build = inputData.getString(BUILD) ?: return Result.success(),
        url = inputData.getString(URL) ?: return Result.success(),
        size = inputData.getLong(SIZE, -1),
        sha256 = inputData.getString(SHA256) ?: return Result.success(),
      )
    val context = applicationContext
    SpeedLimitPackUpdater(TrackingRuntime.speedLimitPackStore(context)) {
      !isStopped &&
        TrackingRuntime.isDriveDetectionOn(context) &&
        !TrackingRuntime.driveRecorder(context).recording &&
        isUnmetered(context)
    }.update(request)
    return Result.success()
  }

  private fun isUnmetered(context: Context): Boolean {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return false
    val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
  }

  companion object {
    private const val WORK_NAME = "openbeacon-speed-limit-pack"
    private const val REGION_ID = "regionId"
    private const val BUILD = "build"
    private const val URL = "url"
    private const val SIZE = "size"
    private const val SHA256 = "sha256"

    fun enqueue(context: Context, request: PackRequest) {
      val work =
        OneTimeWorkRequestBuilder<SpeedLimitPackWorker>()
          .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
          .setInputData(
            workDataOf(
              REGION_ID to request.regionId,
              BUILD to request.build,
              URL to request.url,
              SIZE to request.size,
              SHA256 to request.sha256,
            ),
          ).build()
      WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, work)
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
  }
}
