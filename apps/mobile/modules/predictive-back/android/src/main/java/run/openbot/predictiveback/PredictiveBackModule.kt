package run.openbot.predictiveback

import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.PixelCopy
import android.view.View
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.RequiresApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt
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
  /** The activity [callback] is registered on: a recreated activity gets its own (the old one is gone). */
  private var owner: ComponentActivity? = null
  private var gesture = false
  /** What JavaScript asked for last; a Back handed on to React Native restores this, not `true`. */
  private var wanted = false

  override fun definition() = ModuleDefinition {
    Name("OpenBotPredictiveBack")
    Events("onBackStart", "onBackProgress", "onBackCancel", "onBackInvoke")

    /**
     * Build 11.3 motion B3 (audit N01): a still of the window for the zoom open/close, without blocking
     * the main thread. Skia's makeImageFromView software-drew the whole navigator into a full-size
     * bitmap ON the main thread (tens of ms at the first frames of every open and Back). PixelCopy
     * copies the last frame the GPU drew, scaled into a `scale`-size bitmap, on a background thread,
     * where it is also encoded (JPEG, base64). Only the request itself is posted to the main thread.
     * Resolves null when there is nothing to copy (no activity, below API 26, copy failed).
     */
    AsyncFunction("captureWindow") { scale: Double, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(null)
        return@AsyncFunction
      }
      captureWindow(activity, scale, promise)
    }

    /** Whether the system can send progress at all (API 34+). */
    Function("hasProgress") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE }

    Function("setEnabled") { enabled: Boolean ->
      val activity = appContext.currentActivity as? ComponentActivity ?: return@Function false
      activity.runOnUiThread {
        if (owner !== activity) {
          callback = null
          owner = activity
          installReactBack(activity)
        }
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
            isEnabled = wanted
          }
        }.also {
          activity.onBackPressedDispatcher.addCallback(activity, it)
          callback = it
        }
        // Build 11.2 fix (stuck Back): turned off mid gesture, the system sends this callback no cancel or
        // invoke any more, so JavaScript is told here, or its close would wait for an end that never comes.
        if (!enabled && gesture) {
          gesture = false
          sendEvent("onBackCancel", emptyMap<String, Any>())
        }
        wanted = enabled
        current.isEnabled = enabled
      }
      true
    }

    // The base Back must be in the dispatcher before any screen's callback, so from the first activity on.
    OnCreate {
      (appContext.currentActivity as? ComponentActivity)?.let { activity -> activity.runOnUiThread { installReactBack(activity) } }
    }

    OnActivityEntersForeground {
      (appContext.currentActivity as? ComponentActivity)?.let { activity -> activity.runOnUiThread { installReactBack(activity) } }
    }

    OnDestroy {
      captureThread?.quitSafely()
      captureThread = null
      callback?.remove()
      callback = null
      owner = null
    }
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun captureWindow(activity: android.app.Activity, scale: Double, promise: Promise) {
    // Sizes are plain fields and the bitmap is allocated here (the module's background queue).
    val window = activity.window
    // The React root (android.R.id.content), the area the navigator fills, as the Skia capture was.
    val view = window.peekDecorView()?.let { it.findViewById<View>(android.R.id.content) ?: it }
    val width = view?.width ?: 0
    val height = view?.height ?: 0
    if (width <= 0 || height <= 0) {
      promise.resolve(null)
      return
    }
    val factor = scale.coerceIn(0.1, 1.0)
    val bitmap = try {
      Bitmap.createBitmap(max(1, (width * factor).roundToInt()), max(1, (height * factor).roundToInt()), Bitmap.Config.ARGB_8888)
    } catch (error: Throwable) {
      promise.resolve(null)
      return
    }
    activity.runOnUiThread {
      try {
        val at = IntArray(2)
        view?.getLocationInWindow(at)
        val area = Rect(at[0], at[1], at[0] + width, at[1] + height)
        PixelCopy.request(window, area, bitmap, { result ->
          if (result != PixelCopy.SUCCESS) {
            bitmap.recycle()
            promise.resolve(null)
            return@request
          }
          val out = ByteArrayOutputStream(256 * 1024)
          bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
          bitmap.recycle()
          promise.resolve(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        }, captureHandler())
      } catch (error: Throwable) {
        bitmap.recycle()
        promise.resolve(null)
      }
    }
  }

  private var captureThread: HandlerThread? = null

  private fun captureHandler(): Handler {
    val thread = captureThread ?: HandlerThread("OpenBotWindowCapture").also {
      it.start()
      captureThread = it
    }
    return Handler(thread.looper)
  }

  private val reactBackOn = java.util.Collections.newSetFromMap(java.util.WeakHashMap<ComponentActivity, Boolean>())

  /**
   * Build 11.2 fix (Back did nothing / left the app): predictiveBackGestureEnabled puts
   * enableOnBackInvokedCallback in the manifest, and from Android 13 the system then never calls
   * Activity.onBackPressed, which is how React Native hears Back (BackHandler, React Navigation's pop).
   * React Native adds its own dispatcher callback for that only on Android 16 (API 36). Below it, this
   * one does the same: the lowest callback, it hands Back to ReactActivity.onBackPressed. When
   * JavaScript lets Back through (invokeDefaultOnBackPressed), the activity's default runs.
   */
  private fun installReactBack(activity: ComponentActivity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || Build.VERSION.SDK_INT >= 36) return
    if (!reactBackOn.add(activity)) return
    activity.onBackPressedDispatcher.addCallback(activity, object : OnBackPressedCallback(true) {
      @Suppress("DEPRECATION")
      override fun handleOnBackPressed() {
        isEnabled = false
        // JavaScript let this Back through: the default (leave the app) instead of asking it again.
        if (Throwable().stackTrace.any { it.methodName == "invokeDefaultOnBackPressed" }) activity.onBackPressedDispatcher.onBackPressed()
        else activity.onBackPressed()
        isEnabled = true
      }
    })
  }
}
