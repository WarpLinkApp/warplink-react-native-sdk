package app.warplink.reactnative

import com.facebook.react.bridge.WritableMap
import app.warplink.DeferredCheckStatus

/**
 * The deferred check status, lowered to the map JavaScript reads: `state`, plus
 * `retryAt` in epoch milliseconds for `waiting` only.
 */
internal object DeferredStatusSerializer {

    /** The plain fields, kept apart from the native map so tests can read them. */
    fun fields(status: DeferredCheckStatus): Map<String, Any?> = when (status) {
        DeferredCheckStatus.NotChecked -> mapOf("state" to "notChecked")
        DeferredCheckStatus.Checking -> mapOf("state" to "checking")
        DeferredCheckStatus.Matched -> mapOf("state" to "matched")
        DeferredCheckStatus.NoMatch -> mapOf("state" to "noMatch")
        is DeferredCheckStatus.Waiting ->
            mapOf("state" to "waiting", "retryAt" to status.retryAtMillis)
        DeferredCheckStatus.SkippedOldInstall -> mapOf("state" to "skippedOldInstall")
        DeferredCheckStatus.Stopped -> mapOf("state" to "stopped")
    }

    fun serialize(status: DeferredCheckStatus): WritableMap = toWritableMap(fields(status))
}
