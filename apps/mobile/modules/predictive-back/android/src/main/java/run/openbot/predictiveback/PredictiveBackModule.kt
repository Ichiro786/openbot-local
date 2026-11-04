package run.openbot.predictiveback

import android.os.Build
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Build 11.2: the zoom-close of a ColorOS chat. While JavaScript enables it (a zoom-opened chat is in
 * front and nothing in it takes Back first), this callback takes Back before React Native's own. On
 * Android 14+ with gesture navigation the system sends the predictive back progress (start, progress
 * 0..1, cancel, invoke) and JavaScript drives the shrink of the chat toward its home row with it.
 *
 * A Back with no start before it (3-button navigation, a hardware key) is handed on to React Native's
 * callback unchanged, so React Navigation pops the chat and the non-interactive zoom-close plays.
 * Disabled, it is never consulted: react-native-screens and React Native handle Back as before.
 */
class PredictiveBackModule : Module() {
  private var callback: OnBackPressedCallback? = null
  private var gesture = false

  override fun definition() = ModuleDefinition {
    Name("OpenBotPredictiveBack")
    Events("onBackStart", "onBackProgress", "onBackCancel", "onBackInvoke")

    /** Whether the system can send progress at all (API 34+). */
    Function("hasProgress") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE }

    Function("setEnabled") { enabled: Boolean ->
      val activity = appContext.currentActivity as? ComponentActivity ?: return@Function false
      activity.runOnUiThread {
        val current = callback ?: object : OnBackPressedCallback(false) {
          override fun handleOnBackStarted(backEvent: BackEventCompat) {
            gesture = true
            sendEvent("onBackStart", mapOf("progress" to backEvent.progress.toDouble(), "edge" to backEvent.swipeEdge))
          }

          override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            if (gesture) sendEvent("onBackProgress", mapOf("progress" to backEvent.progress.toDouble()))
          }

          override fun handleOnBackCancelled() {
            if (!gesture) return
            gesture = false
            sendEvent("onBackCancel", emptyMap<String, Any>())
          }

          override fun handleOnBackPressed() {
            if (gesture) {
              gesture = false
              sendEvent("onBackInvoke", emptyMap<String, Any>())
              return
            }
            // No gesture: React Native's Back, as if this callback were not here.
            isEnabled = false
            activity.onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }.also {
          activity.onBackPressedDispatcher.addCallback(activity, it)
          callback = it
        }
        if (!enabled) gesture = false
        current.isEnabled = enabled
      }
      true
    }

    OnDestroy {
      callback?.remove()
      callback = null
    }
  }
}
