package app.warplink.reactnative

import com.facebook.react.bridge.WritableMap
import app.warplink.TetherReadResult

/**
 * A Tether outcome, lowered to the map JavaScript reads: `kind` plus `reason`.
 *
 * Android never reads the clipboard, so the only outcome is "no code" with no
 * reason. JavaScript reads a null reason as "this platform reads nothing".
 */
internal object TetherSerializer {

    /** The plain fields, kept apart from the native map so tests can read them. */
    fun fields(result: TetherReadResult): Map<String, Any?> = when (result) {
        TetherReadResult.NoClipboard -> mapOf("kind" to "noCode", "reason" to null)
    }

    fun serialize(result: TetherReadResult): WritableMap = toWritableMap(fields(result))
}
