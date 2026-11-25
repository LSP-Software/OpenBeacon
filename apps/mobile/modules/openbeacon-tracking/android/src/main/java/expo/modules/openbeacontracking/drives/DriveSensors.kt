package expo.modules.openbeacontracking.drives

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat

class DriveSensors(
  private val context: Context,
  private val recorder: DriveRecorder,
) : SensorEventListener {
  private val sensorManager = context.getSystemService(SensorManager::class.java)
  private val audioManager = context.getSystemService(AudioManager::class.java)
  private val handler = Handler(Looper.getMainLooper())
  private val samples = mutableListOf<AccelerometerSample>()
  private var running = false
  private var inHandheldCall = false

  private val deliverSamples =
    Runnable {
      val batch = synchronized(samples) { samples.toList().also { samples.clear() } }
      if (batch.isNotEmpty()) recorder.onAccelerometer(batch)
    }

  private val pollCall =
    object : Runnable {
      override fun run() {
        checkCall()
        handler.postDelayed(this, CALL_POLL_MS)
      }
    }

  private val callChanged = Runnable { checkCall() }
  private val modeListener by lazy { AudioManager.OnModeChangedListener { handler.post(callChanged) } }
  private val deviceListener by lazy { AudioManager.OnCommunicationDeviceChangedListener { handler.post(callChanged) } }

  private val screenReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(
        context: Context,
        intent: Intent,
      ) {
        val signal =
          when (intent.action) {
            Intent.ACTION_SCREEN_ON -> PhoneUseSignal.SCREEN_ON
            Intent.ACTION_SCREEN_OFF -> PhoneUseSignal.SCREEN_OFF
            Intent.ACTION_USER_PRESENT -> PhoneUseSignal.UNLOCKED
            else -> return
          }
        recorder.onPhoneUse(PhoneUseChange(System.currentTimeMillis(), signal))
      }
    }

  @Synchronized
  fun update(on: Boolean) {
    if (on == running) return
    running = on
    if (on) start() else stop()
  }

  private fun start() {
    sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensor ->
      sensorManager.registerListener(this, sensor, SAMPLING_PERIOD_US, MAX_REPORT_LATENCY_US, handler)
    }
    ContextCompat.registerReceiver(
      context,
      screenReceiver,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_USER_PRESENT)
      },
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    val now = System.currentTimeMillis()
    val interactive = context.getSystemService(PowerManager::class.java)?.isInteractive == true
    val locked = context.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked != false
    recorder.onPhoneUse(PhoneUseChange(now, if (interactive) PhoneUseSignal.SCREEN_ON else PhoneUseSignal.SCREEN_OFF))
    if (interactive && !locked) recorder.onPhoneUse(PhoneUseChange(now, PhoneUseSignal.UNLOCKED))
    inHandheldCall = isHandheldCall()
    recorder.onPhoneUse(PhoneUseChange(now, if (inHandheldCall) PhoneUseSignal.HANDHELD_CALL_STARTED else PhoneUseSignal.HANDHELD_CALL_ENDED))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && audioManager != null) {
      audioManager.addOnModeChangedListener(ContextCompat.getMainExecutor(context), modeListener)
      audioManager.addOnCommunicationDeviceChangedListener(ContextCompat.getMainExecutor(context), deviceListener)
    } else {
      handler.postDelayed(pollCall, CALL_POLL_MS)
    }
  }

  private fun stop() {
    sensorManager?.unregisterListener(this)
    runCatching { context.unregisterReceiver(screenReceiver) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && audioManager != null) {
      audioManager.removeOnModeChangedListener(modeListener)
      audioManager.removeOnCommunicationDeviceChangedListener(deviceListener)
    }
    handler.removeCallbacks(pollCall)
    handler.removeCallbacks(callChanged)
    handler.removeCallbacks(deliverSamples)
    deliverSamples.run()
  }

  private fun checkCall() {
    val handheld = isHandheldCall()
    if (handheld == inHandheldCall) return
    inHandheldCall = handheld
    recorder.onPhoneUse(
      PhoneUseChange(System.currentTimeMillis(), if (handheld) PhoneUseSignal.HANDHELD_CALL_STARTED else PhoneUseSignal.HANDHELD_CALL_ENDED),
    )
  }

  @Suppress("DEPRECATION")
  private fun isHandheldCall(): Boolean {
    val audio = audioManager ?: return false
    if (audio.mode != AudioManager.MODE_IN_CALL && audio.mode != AudioManager.MODE_IN_COMMUNICATION) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return audio.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
    val handsFree =
      audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type in setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
      }
    return !audio.isSpeakerphoneOn && !handsFree
  }

  override fun onSensorChanged(event: SensorEvent) {
    val timeMillis = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L
    val first =
      synchronized(samples) {
        samples += AccelerometerSample(timeMillis, event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
        samples.size == 1
      }
    if (first) handler.postDelayed(deliverSamples, DELIVER_DELAY_MS)
  }

  override fun onAccuracyChanged(
    sensor: Sensor,
    accuracy: Int,
  ) = Unit

  companion object {
    private const val SAMPLING_PERIOD_US = 40_000
    private const val MAX_REPORT_LATENCY_US = 10_000_000
    private const val DELIVER_DELAY_MS = 250L
    private const val CALL_POLL_MS = 2_000L
  }
}
