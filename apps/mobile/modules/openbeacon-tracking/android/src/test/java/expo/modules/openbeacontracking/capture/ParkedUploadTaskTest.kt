package expo.modules.openbeacontracking.capture

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.time.Duration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class ParkedUploadTaskTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val tasks = HeadlessJsTaskContext.getInstance(BridgeReactContext(application))

  @Test
  fun theParkedCheckEndsAsSoonAsJavaScriptFinishesIt() {
    val data = JavaOnlyMap()
    val job = CoroutineScope(Dispatchers.Unconfined).launch { SharingResumeWorker.runParkedTask(tasks, data) }
    assertEquals("parked", data.getString("reason"))
    assertTrue(tasks.hasActiveTasks())

    UploadTasks.finish(checkNotNull(data.getString("taskToken")) { "JavaScript needs a token to finish the parked task" })
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))

    assertTrue(job.isCompleted)
    assertFalse(tasks.hasActiveTasks())
  }

  @Test
  fun theParkedCheckStillEndsAtTheTimeoutWhenJavaScriptNeverFinishes() {
    val job = CoroutineScope(Dispatchers.Unconfined).launch { SharingResumeWorker.runParkedTask(tasks, JavaOnlyMap()) }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(UploadTasks.TIMEOUT_MS - 1))
    assertFalse(job.isCompleted)

    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))
    assertTrue(job.isCompleted)
  }

  @Test
  fun aTokenFinishesOnlyItsOwnTask() {
    val first = JavaOnlyMap()
    val second = JavaOnlyMap()
    val firstJob = CoroutineScope(Dispatchers.Unconfined).launch { SharingResumeWorker.runParkedTask(tasks, first) }
    val secondJob = CoroutineScope(Dispatchers.Unconfined).launch { SharingResumeWorker.runParkedTask(tasks, second) }

    UploadTasks.finish(checkNotNull(second.getString("taskToken")))
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))

    assertFalse(firstJob.isCompleted)
    assertTrue(secondJob.isCompleted)
  }
}
