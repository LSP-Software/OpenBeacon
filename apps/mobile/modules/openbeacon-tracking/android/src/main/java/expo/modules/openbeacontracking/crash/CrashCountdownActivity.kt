package expo.modules.openbeacontracking.crash

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.openbeacontracking.R
import expo.modules.openbeacontracking.drives.CrashCountdown
import expo.modules.openbeacontracking.drives.CrashCountdownPhase
import java.util.Date
import java.util.Locale

class CrashCountdownActivity : Activity() {
  private val refresh = { runOnUiThread { render() } }
  private val ticker =
    object : Runnable {
      override fun run() {
        render()
        window.decorView.postDelayed(this, 250)
      }
    }
  private lateinit var root: LinearLayout

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    window.statusBarColor = RED_BLACK
    window.navigationBarColor = SHEET
    root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val scroll =
      ScrollView(this).apply {
        isFillViewport = true
        setBackgroundColor(SHEET)
        addView(root)
      }
    ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(0, 0, 0, bars.bottom)
      insets
    }
    setContentView(scroll)
    CrashCountdownController.resume(this)
  }

  override fun onStart() {
    super.onStart()
    CrashCountdownController.addListener(refresh)
    window.decorView.post(ticker)
  }

  override fun onStop() {
    CrashCountdownController.removeListener(refresh)
    window.decorView.removeCallbacks(ticker)
    super.onStop()
  }

  private var shown: Pair<CrashCountdownPhase, Int>? = null

  private fun render() {
    val countdown = CrashCountdownController.current
    if (countdown == null) {
      finish()
      return
    }
    val seconds = countdown.secondsLeft(System.currentTimeMillis())
    val key = countdown.phase to seconds
    if (key == shown) return
    shown = key
    root.removeAllViews()
    when (countdown.phase) {
      CrashCountdownPhase.COUNTING -> renderCounting(countdown, seconds)
      CrashCountdownPhase.SENT -> renderWaiting(countdown)
      CrashCountdownPhase.TEST_FINISHED -> renderTestFinished()
      else -> finish()
    }
  }

  private fun renderCounting(
    countdown: CrashCountdown,
    seconds: Int,
  ) {
    val (groups, groupCount) = CrashCountdownController.groupsLabel(this)
    if (countdown.test) {
      root.addView(
        text(getString(R.string.openbeacon_crash_test_strip), 14f, Color.WHITE, bold = true).apply {
          gravity = Gravity.CENTER
          setBackgroundColor(TEST_GREY)
          setPadding(dp(16), statusBarHeight() + dp(10), dp(16), dp(10))
        },
      )
    }
    val caption =
      if (countdown.test) {
        getString(R.string.openbeacon_crash_test_caption, groups)
      } else {
        getString(if (groupCount == 1) R.string.openbeacon_crash_seconds_until_one else R.string.openbeacon_crash_seconds_until, groups)
      }
    root.addView(
      header(top = !countdown.test).apply {
        addView(text(getString(R.string.openbeacon_crash_title), 30f, Color.WHITE, bold = true).apply { setPadding(0, dp(12), 0, 0) })
        addView(
          text(seconds.toString(), 112f, DIGITS, bold = true).apply {
            fontFeatureSettings = "tnum"
            includeFontPadding = false
            contentDescription = getString(R.string.openbeacon_crash_seconds_left, seconds)
          },
        )
        addView(text(caption, 18f, Color.WHITE))
      },
    )
    val sheet = sheet()
    sheet.addView(label(getString(R.string.openbeacon_crash_will_see, capitalise(groups))))
    val suspicion = countdown.suspicion
    sheet.addView(
      card(
        listOf(
          getString(R.string.openbeacon_crash_time) to DateFormat.getTimeFormat(this).format(Date(suspicion.timeMillis)),
          getString(R.string.openbeacon_crash_where) to
            if (suspicion.latitude.isFinite()) coordinates(suspicion.latitude, suspicion.longitude) else getString(R.string.openbeacon_crash_test_where),
          getString(R.string.openbeacon_crash_speed_before) to
            if (suspicion.speedBefore.isFinite()) {
              CrashCountdownController.formatSpeed(this, suspicion.speedBefore)
            } else {
              getString(R.string.openbeacon_crash_test_speed)
            },
        ),
      ),
    )
    sheet.addView(button(getString(R.string.openbeacon_crash_im_ok), GREEN, Color.WHITE, large = true) { CrashCountdownController.imOk(this) }, spaced(20))
    val number = CrashCountdownController.emergencyNumber(this)
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    row.addView(button(getString(R.string.openbeacon_crash_send_now), TONAL, INK) { CrashCountdownController.sendNow(this) }, weighted(0))
    if (!countdown.test) {
      row.addView(button(getString(R.string.openbeacon_crash_call, number), TONAL, INK) { CrashCountdownController.openDialer(this, this) }, weighted(dp(12)))
    }
    sheet.addView(row, spaced(12))
    if (!countdown.test) {
      sheet.addView(button(getString(R.string.openbeacon_crash_text_someone), SHEET, INK, outlined = true) { textSomeone(countdown) }, spaced(12))
    }
    sheet.addView(text(getString(R.string.openbeacon_crash_may_help, number), 16f, INK), spaced(20))
    root.addView(sheet, fill())
  }

  private fun renderWaiting(countdown: CrashCountdown) {
    val number = CrashCountdownController.emergencyNumber(this)
    root.addView(
      header(top = true).apply {
        addView(text(getString(R.string.openbeacon_crash_not_sent_title), 30f, Color.WHITE, bold = true).apply { setPadding(0, dp(12), 0, dp(8)) })
        addView(text(getString(R.string.openbeacon_crash_not_sent_body), 18f, Color.WHITE))
      },
    )
    val sheet = sheet()
    sheet.addView(label(getString(R.string.openbeacon_crash_waiting)))
    sheet.addView(
      card(
        CrashCountdownController.alertGroupNames(this).map { it to getString(R.string.openbeacon_crash_waiting_for_signal) } +
          (getString(R.string.openbeacon_crash_gives_up_at) to DateFormat.getTimeFormat(this).format(Date(countdown.suspicion.timeMillis + GIVE_UP_MILLIS))),
      ),
    )
    sheet.addView(button(getString(R.string.openbeacon_crash_call, number), ALARM_RED, Color.WHITE, large = true) { CrashCountdownController.openDialer(this, this) }, spaced(20))
    sheet.addView(text(getString(R.string.openbeacon_crash_calls_without_signal), 14f, INK).apply { gravity = Gravity.CENTER }, spaced(6))
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    row.addView(button(getString(R.string.openbeacon_crash_im_ok), TONAL, INK) { CrashCountdownController.imOk(this) }, weighted(0))
    row.addView(button(getString(R.string.openbeacon_crash_text_someone), TONAL, INK) { textSomeone(countdown) }, weighted(dp(12)))
    sheet.addView(row, spaced(12))
    sheet.addView(text(getString(R.string.openbeacon_crash_may_help, number), 16f, INK), spaced(20))
    root.addView(sheet, fill())
  }

  private fun renderTestFinished() {
    window.statusBarColor = SHEET
    val (groups) = CrashCountdownController.groupsLabel(this)
    val column =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(24), dp(96), dp(24), dp(24))
      }
    column.addView(
      text("✓", 36f, GREEN, bold = true).apply {
        gravity = Gravity.CENTER
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(0xFFE3EFE6.toInt())
        }
      },
      LinearLayout.LayoutParams(dp(72), dp(72)),
    )
    column.addView(text(getString(R.string.openbeacon_crash_test_finished_title), 24f, INK, bold = true).apply { gravity = Gravity.CENTER }, spaced(16))
    column.addView(text(getString(R.string.openbeacon_crash_test_finished_body, groups), 16f, INK).apply { gravity = Gravity.CENTER }, spaced(12))
    column.addView(
      button(getString(R.string.openbeacon_crash_done), GREEN, Color.WHITE) {
        CrashCountdownController.close(this)
        finish()
      },
      spaced(24),
    )
    root.addView(column, fill())
  }

  private fun textSomeone(countdown: CrashCountdown) {
    val suspicion = countdown.suspicion
    val where =
      if (suspicion.latitude.isFinite()) {
        String.format(Locale.ROOT, "https://www.openstreetmap.org/?mlat=%.5f&mlon=%.5f#map=17/%.5f/%.5f", suspicion.latitude, suspicion.longitude, suspicion.latitude, suspicion.longitude)
      } else {
        ""
      }
    CrashCountdownController.openTextMessage(
      this,
      this,
      getString(R.string.openbeacon_crash_sms, DateFormat.getTimeFormat(this).format(Date(suspicion.timeMillis)), where).trim(),
    )
  }

  private fun header(top: Boolean) =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(RED_BLACK)
      setPadding(dp(24), (if (top) statusBarHeight() else 0) + dp(20), dp(24), dp(40))
      addView(text(getString(R.string.openbeacon_crash_app), 16f, ROSE))
    }

  private fun sheet() =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(20), dp(20), dp(24))
      background =
        GradientDrawable().apply {
          setColor(SHEET)
          cornerRadii = floatArrayOf(dp(28).toFloat(), dp(28).toFloat(), dp(28).toFloat(), dp(28).toFloat(), 0f, 0f, 0f, 0f)
        }
      translationY = -dp(24).toFloat()
    }

  private fun card(rows: List<Pair<String, String>>) =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = rounded(Color.WHITE, 16)
      setPadding(dp(16), dp(4), dp(16), dp(4))
      rows.forEachIndexed { index, (name, value) ->
        if (index > 0) addView(View(context).apply { setBackgroundColor(DIVIDER) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        addView(
          LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(14), 0, dp(14))
            addView(text(name, 17f, INK), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(text(value, 15f, MUTED).apply { gravity = Gravity.END })
          },
        )
      }
    }

  private fun label(value: String) = text(value, 15f, INK, bold = true).apply { setPadding(dp(4), 0, 0, dp(10)) }

  private fun button(
    title: String,
    fill: Int,
    ink: Int,
    large: Boolean = false,
    outlined: Boolean = false,
    onPress: () -> Unit,
  ) = Button(this).apply {
    text = title
    isAllCaps = false
    setTextColor(ink)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, if (large) 24f else 17f)
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    stateListAnimator = null
    minHeight = dp(if (large) 72 else 56)
    background =
      rounded(fill, 40).apply {
        if (outlined) setStroke(dp(1), MUTED)
      }
    setOnClickListener { onPress() }
  }

  private fun text(
    value: String,
    size: Float,
    color: Int,
    bold: Boolean = false,
  ) = TextView(this).apply {
    text = value
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
  }

  private fun rounded(
    color: Int,
    radius: Int,
  ) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = dp(radius).toFloat()
  }

  private fun capitalise(value: String) = value.replaceFirstChar { it.titlecase(Locale.getDefault()) }

  private fun coordinates(
    latitude: Double,
    longitude: Double,
  ) = String.format(Locale.getDefault(), "%.5f, %.5f", latitude, longitude)

  private fun spaced(top: Int) =
    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

  private fun weighted(start: Int) = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = start }

  private fun fill() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)

  private fun statusBarHeight(): Int {
    val id = resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) resources.getDimensionPixelSize(id) else dp(24)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  companion object {
    private const val RED_BLACK = 0xFF2A0A0C.toInt()
    private const val ALARM_RED = 0xFFB3261E.toInt()
    private const val GREEN = 0xFF1E6B3A.toInt()
    private const val SHEET = 0xFFFCF7F7.toInt()
    private const val TONAL = 0xFFF1E4E3.toInt()
    private const val INK = 0xFF231A1B.toInt()
    private const val MUTED = 0xFF5D4F50.toInt()
    private const val DIVIDER = 0xFFEDE3E3.toInt()
    private const val DIGITS = 0xFFEDE7E7.toInt()
    private const val ROSE = 0xFFF2B8B5.toInt()
    private const val TEST_GREY = 0xFF4B5961.toInt()
    private const val GIVE_UP_MILLIS = 2 * 60 * 60_000L

    fun intent(context: Context) = Intent(context, CrashCountdownActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }
}
