package app.warplink.reactnative

import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/**
 * The cold-start link, held until JavaScript asks for it exactly once.
 *
 * This exists because reading the launching intent at module construction does
 * not work, and neither does reading it lazily. React Native 0.76 runs the
 * JavaScript bundle inside `ReactInstanceManager.createReactContext`, and only
 * afterwards does `setupReactContext` attach the Activity through
 * `moveReactContextToCurrentLifecycleState`. A host that calls `configure()` at
 * module import therefore asks while `currentActivity` is still null. A lazy
 * read finds nothing, settles the promise null, and the link that opened the
 * app is gone for the life of the process.
 *
 * So when there is nothing to answer with and no Activity yet, the promise is
 * PARKED on a lifecycle listener and answered at `onHostResume`, which is the
 * first moment the Activity and its intent exist. This is what React Native's
 * own Linking module does for the same reason
 * (`IntentModule.waitForActivityAndGetInitialURL`).
 *
 * Exactly one delivery per launch. A warm-start event claims the link instead,
 * because that url belongs to the event, and any promise parked at that moment
 * is answered null rather than left hanging.
 *
 * Bead: warplink-15uj.
 */
internal class InitialUrlBuffer(
    private val context: ReactApplicationContext,
) : LifecycleEventListener {

    private var url: String? = null
    private var settled = false
    private var parked: Promise? = null
    private var listening = false

    /** Read the launching intent if it is there and nothing has claimed it. */
    fun capture() {
        if (settled) return
        context.currentActivity?.intent?.data?.let { uri -> url = uri.toString() }
    }

    /**
     * Answer JavaScript, now or when the Activity resumes.
     *
     * A second caller while one is parked is answered null immediately: one
     * launch carries one link, and the parked promise owns it.
     */
    fun read(promise: Promise) {
        capture()
        if (url == null && !settled && context.currentActivity == null) {
            park(promise)
            return
        }
        settle(promise)
    }

    /** A warm-start intent owns its url, so the buffer must not hand it out too. */
    fun claimedByEvent() {
        url = null
        settled = true
        releaseParked()
    }

    override fun onHostResume() {
        capture()
        releaseParked()
    }

    override fun onHostPause() = Unit

    override fun onHostDestroy() {
        // The process is going away with a promise still parked. Answer it
        // rather than leaving JavaScript waiting on a promise that can never
        // settle.
        releaseParked()
    }

    private fun park(promise: Promise) {
        if (parked != null) {
            promise.resolve(null)
            return
        }
        parked = promise
        if (!listening) {
            context.addLifecycleEventListener(this)
            listening = true
        }
    }

    private fun releaseParked() {
        val promise = parked ?: return
        parked = null
        stopListening()
        settle(promise)
    }

    private fun settle(promise: Promise) {
        val answer = url
        url = null
        settled = true
        promise.resolve(answer)
    }

    private fun stopListening() {
        if (!listening) return
        context.removeLifecycleEventListener(this)
        listening = false
    }
}
