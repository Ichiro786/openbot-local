package run.openbot.engine

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import org.json.JSONObject

/**
 * Android Live Updates for running agent turns (OpenBot Local).
 *
 * The JS side reuses the upstream Dynamic Island / Live Activity logic and hands this object the same
 * props the iOS widget gets (mode, label, title, detail, tint, tap link, buttons). Here they become:
 *  - Android 16+ (API 36): a promoted ongoing notification with Notification.ProgressStyle, a short
 *    critical text for the status bar chip and lock screen. OEM skins show it in their own surfaces
 *    (realme UI / ColorOS 16 "Live Alerts", One UI "Now bar").
 *  - Android 8-15: a normal ongoing notification with an indeterminate progress bar.
 *
 * States: "working" is ongoing with an animated (indeterminate) track; "question" / "approval" /
 * "takeover" are ongoing and ask for the user with the answer buttons; "message" is the finished turn
 * ("Done", the reply lead) which dismisses itself after a few seconds; "failed" is the error state.
 * Local notifications only, no FCM.
 */
object LiveUpdates {
  const val CHANNEL_ID = "openbot_live_updates"
  private const val NOTIFICATION_ID = 0x0B08
  private const val DONE_TIMEOUT_MS = 6_000L
  private const val FAILED_TIMEOUT_MS = 30_000L
  private const val API_BAKLAVA = 36

  @Volatile private var accentColor: Int? = null
  @Volatile private var shown = false
  @Volatile private var startedAt = 0L
  @Volatile private var lastMode: String? = null

  /** The app accent (Material You or brand) that colors the track and icon. Null keeps the brand color. */
  fun setAccent(color: String?) {
    accentColor = color?.let { runCatching { Color.parseColor(it) }.getOrNull() }
  }

  fun isShown(): Boolean = shown

  fun canPromote(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < API_BAKLAVA) return false
    return runCatching { manager(context).canPostPromotedNotifications() }.getOrDefault(false)
  }

  fun show(context: Context, json: String) {
    val props = runCatching { JSONObject(json) }.getOrNull() ?: return
    val manager = manager(context)
    if (!manager.areNotificationsEnabled()) return
    createChannel(context, manager)
    val mode = props.optString("mode", "working")
    // "message" is the island's unread-reply state. It is the end of a turn this update showed; an
    // unread reply with no running turn before it stays with the normal notifications.
    if (mode == "message" && !shown) return
    if (!shown || lastMode == null) startedAt = System.currentTimeMillis()
    // A new turn after a finished one starts its timer again.
    if (lastMode != null && lastMode != "working" && mode == "working") startedAt = System.currentTimeMillis()
    lastMode = mode
    val notification = build(context, props, mode)
    runCatching { manager.notify(NOTIFICATION_ID, notification) }
    shown = mode != "message"
  }

  /** Ends the update. A running turn that ends without a reply shows nothing more. */
  fun end(context: Context) {
    shown = false
    lastMode = null
    runCatching { manager(context).cancel(NOTIFICATION_ID) }
  }

  private fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun createChannel(context: Context, manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // DEFAULT importance: promotion needs more than MIN/LOW, and no sound plays because every
    // notification here is silent (setOnlyAlertOnce + setSilent).
    val channel = NotificationChannel(CHANNEL_ID, "Live updates for running tasks", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Shows what your agents are doing right now, in the status bar and on the lock screen"
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  @SuppressLint("DiscouragedApi")
  private fun smallIcon(context: Context): Int {
    val res = context.resources
    val id = res.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  private fun openIntent(context: Context, url: String?, requestCode: Int): PendingIntent {
    // An explicit component: the app's VIEW filter only declares its own scheme, and the Live
    // Activity links use openbot://live-activity, which +native-intent reads from the intent data.
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    val intent = Intent(launch).apply {
      action = if (url.isNullOrBlank()) Intent.ACTION_MAIN else Intent.ACTION_VIEW
      if (!url.isNullOrBlank()) data = Uri.parse(url)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun parseColor(value: String?, fallback: Int): Int =
    value?.takeIf { it.isNotBlank() }?.let { runCatching { Color.parseColor(it) }.getOrNull() } ?: fallback

  private fun shortText(value: String, max: Int): String {
    val clean = value.replace(Regex("\\s+"), " ").trim()
    return if (clean.length > max) clean.take(max - 1) + "…" else clean
  }

  /** Inline Markdown from the island props, as plain text for a notification. */
  private fun plain(value: String): String =
    value.replace(Regex("[*_`~]+"), "").replace(Regex("\\[([^\\]]*)]\\([^)]*\\)"), "$1").trim()

  private fun build(context: Context, props: JSONObject, mode: String): Notification {
    val brand = accentColor ?: Color.parseColor("#6960F1")
    val tint = parseColor(props.optString("tint"), brand)
    val stateColor = when (mode) {
      "working" -> accentColor ?: tint
      "message" -> Color.parseColor("#31CF76")
      "failed" -> Color.parseColor("#FD2F3B")
      else -> Color.parseColor("#FF9412")
    }
    val label = props.optString("label").ifBlank { "Working" }
    val title = plain(props.optString("title")).ifBlank { props.optString("appName", "OpenBot") }
    val detail = plain(props.optString("detail"))
    val footer = props.optString("footer")
    val rows = props.optJSONArray("rows")
    val extraRows = buildList {
      if (rows != null) for (i in 1 until rows.length()) {
        val row = rows.optJSONObject(i) ?: continue
        add("${row.optString("name")}: ${plain(row.optString("text"))}")
      }
    }
    val body = buildString {
      append(if (mode == "message") "Done" else label)
      if (detail.isNotEmpty()) append(" · ").append(detail)
    }
    val bigText = buildString {
      append(detail.ifEmpty { label })
      extraRows.forEach { append("\n").append(it) }
      if (footer.isNotBlank()) append("\n").append(footer)
    }
    val ongoing = mode != "message" && mode != "failed"
    val chip = when (mode) {
      "message" -> "Done"
      "failed" -> "Failed"
      "working" -> shortText(props.optString("compact").ifBlank { label }, 10)
      else -> shortText(label, 10)
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    builder
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(body)
      .setSubText(label)
      .setColor(stateColor)
      .setOngoing(ongoing)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(startedAt)
      .setUsesChronometer(mode == "working")
      .setCategory(if (mode == "working") Notification.CATEGORY_PROGRESS else Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(openIntent(context, props.optString("tapUrl"), 1))
      .setAutoCancel(!ongoing)
      .setLocalOnly(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      when (mode) {
        "message" -> builder.setTimeoutAfter(DONE_TIMEOUT_MS)
        "failed" -> builder.setTimeoutAfter(FAILED_TIMEOUT_MS)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    // Buttons: the answers the island offers (signed links), then Open.
    val buttons = props.optJSONArray("buttons")
    var actions = 0
    if (buttons != null) {
      for (i in 0 until buttons.length()) {
        if (actions >= 2) break
        val button = buttons.optJSONObject(i) ?: continue
        val url = button.optString("url")
        if (url.isBlank()) continue
        builder.addAction(
          Notification.Action.Builder(null as Icon?, shortText(button.optString("label"), 24), openIntent(context, url, 10 + i)).build(),
        )
        actions++
      }
    }
    builder.addAction(
      Notification.Action.Builder(null as Icon?, if (mode == "failed") "Details" else "Open", openIntent(context, props.optString("tapUrl"), 2)).build(),
    )

    if (Build.VERSION.SDK_INT >= API_BAKLAVA) {
      applyLiveUpdate(context, builder, mode, chip, stateColor, tint, bigText)
    } else {
      builder.setStyle(Notification.BigTextStyle().bigText(bigText))
      when (mode) {
        "working" -> builder.setProgress(0, 0, true)
        "message" -> builder.setProgress(100, 100, false)
        else -> Unit
      }
    }
    return builder.build()
  }

  @RequiresApi(API_BAKLAVA)
  private fun applyLiveUpdate(
    context: Context,
    builder: Notification.Builder,
    mode: String,
    chip: String,
    stateColor: Int,
    tint: Int,
    bigText: String,
  ) {
    val style = Notification.ProgressStyle().setStyledByProgress(true)
    when (mode) {
      "working" -> {
        style.setProgressIndeterminate(true)
        style.setProgressSegments(listOf(Notification.ProgressStyle.Segment(100).setColor(stateColor)))
      }
      "message" -> {
        style.setProgressSegments(listOf(Notification.ProgressStyle.Segment(100).setColor(stateColor)))
        style.setProgress(100)
      }
      "failed" -> {
        style.setProgressSegments(listOf(Notification.ProgressStyle.Segment(100).setColor(stateColor)))
        style.setProgressPoints(listOf(Notification.ProgressStyle.Point(100).setColor(stateColor)))
        style.setProgress(100)
      }
      else -> {
        // Waiting on the user: the work so far in the agent color, the point where it waits in amber.
        style.setProgressSegments(
          listOf(
            Notification.ProgressStyle.Segment(70).setColor(tint),
            Notification.ProgressStyle.Segment(30).setColor(Color.argb(80, Color.red(stateColor), Color.green(stateColor), Color.blue(stateColor))),
          ),
        )
        style.setProgressPoints(listOf(Notification.ProgressStyle.Point(70).setColor(stateColor)))
        style.setProgress(70)
      }
    }
    builder.setStyle(style)
    builder.setShortCriticalText(chip)
    // Promotion (status bar chip, lock screen, OEM "Live Alerts") is for ongoing work only, and the
    // system refuses colorized notifications, so the accent stays on the track and icon.
    val ongoing = mode != "message" && mode != "failed"
    builder.setRequestPromotedOngoing(ongoing && canPromote(context))
    // ProgressStyle has no big text: other working agents and the footer go into the subtext line.
    val more = bigText.lineSequence().drop(1).joinToString(" · ")
    if (more.isNotBlank()) builder.setSubText(more.take(80))
  }
}
