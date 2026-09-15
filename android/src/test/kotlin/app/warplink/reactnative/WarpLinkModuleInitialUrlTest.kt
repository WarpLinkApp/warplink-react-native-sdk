package app.warplink.reactnative

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import java.lang.reflect.Proxy
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * The cold-start contract, and the one the React Native Android device pass
 * found broken: the link that launched the app must reach JavaScript.
 *
 * On a cold start React Native constructs the native module before the Activity
 * is attached to the React context, so `currentActivity` is null at that moment.
 * Reading the launching intent only in `init` therefore captured nothing, and
 * `getInitialURL()` answered null for the rest of the process. Warm start was
 * unaffected, because it arrives through `onNewIntent`, which is why the defect
 * survived every compile check and the whole Jest suite.
 *
 * Bead: warplink-15uj.
 */
@RunWith(RobolectricTestRunner::class)
class WarpLinkModuleInitialUrlTest {

    private class CapturingPromise : Promise {
        var value: Any? = null
        var rejected: String? = null
        override fun resolve(value: Any?) {
            this.value = value
        }
        override fun reject(code: String, message: String?) {
            rejected = code
        }
        override fun reject(code: String, message: String?, throwable: Throwable?) {
            rejected = code
        }
    }

    private class TestReactContext :
        ReactApplicationContext(ApplicationProvider.getApplicationContext()) {
        override var currentActivity: Activity? = null
        private val lifecycleListeners = mutableListOf<LifecycleEventListener>()

        override fun addLifecycleEventListener(listener: LifecycleEventListener) {
            lifecycleListeners.add(listener)
        }

        override fun removeLifecycleEventListener(listener: LifecycleEventListener) {
            lifecycleListeners.remove(listener)
        }

        /** The moment React Native attaches the Activity and resumes it. */
        fun emitHostResume() {
            for (listener in lifecycleListeners.toList()) listener.onHostResume()
        }

        fun lifecycleListenerCount(): Int = lifecycleListeners.size

        /**
         * `onNewIntent` emits a JavaScript event, and the stub's default
         * `getJSModule` throws. A no-op proxy keeps the warm-start test about
         * the buffer rather than about the emitter.
         */
        @Suppress("UNCHECKED_CAST")
        override fun <T> getJSModule(type: Class<T>): T =
            Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, _, _ -> null } as T
    }

    private fun activityWith(url: String?): Activity {
        val activity = Robolectric.buildActivity(Activity::class.java).get()
        activity.intent = Intent(Intent.ACTION_VIEW).apply {
            if (url != null) data = Uri.parse(url)
        }
        return activity
    }

    @Test
    fun `getInitialURL returns the launching link when the activity attaches after construction`() {
        val context = TestReactContext()
        // The order a cold start actually produces: the module exists first.
        val module = WarpLinkModule(context)
        context.currentActivity = activityWith("https://aplnk.to/rn11-leg7")

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        assertEquals("https://aplnk.to/rn11-leg7", promise.value)
    }

    @Test
    fun `getInitialURL still returns a link captured at construction`() {
        val context = TestReactContext()
        context.currentActivity = activityWith("https://aplnk.to/rn11-leg7")
        val module = WarpLinkModule(context)

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        assertEquals("https://aplnk.to/rn11-leg7", promise.value)
    }

    @Test
    fun `getInitialURL answers once, so a link is never delivered twice`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)
        context.currentActivity = activityWith("https://aplnk.to/rn11-leg7")

        val first = CapturingPromise()
        module.getInitialURL(first)
        val second = CapturingPromise()
        module.getInitialURL(second)

        assertEquals("https://aplnk.to/rn11-leg7", first.value)
        assertNull(second.value)
    }

    @Test
    fun `a warm-start intent belongs to onNewIntent, never to getInitialURL`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)
        val activity = activityWith("https://aplnk.to/rn11-leg7")
        context.currentActivity = activity

        // The warm-start event fires first and owns this url.
        module.onNewIntent(activity.intent)

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        assertNull(promise.value)
    }

    /**
     * The order the fix on this branch did not cover, and the one a real host
     * hits: JavaScript asks BEFORE the Activity is attached.
     *
     * React Native 0.76 runs the JS bundle inside `createReactContext`
     * (`ReactInstanceManager.runJSBundle`) and only afterwards calls
     * `setupReactContext`, which attaches the Activity through
     * `moveReactContextToCurrentLifecycleState`. A host that calls
     * `WarpLink.configure()` at module import therefore asks while
     * `currentActivity` is still null. Reading the intent lazily is not enough:
     * the read finds nothing, the promise settles null, and the launching link
     * is gone for the life of the process.
     *
     * React Native's own Linking module solves this by parking the promise on a
     * LifecycleEventListener and answering in `onHostResume`
     * (`IntentModule.waitForActivityAndGetInitialURL`). The bridge does the same.
     */
    @Test
    fun `getInitialURL asked before the activity attaches resolves when the activity resumes`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        // Nothing to answer with yet, so the promise must NOT be settled null.
        assertNull(promise.value)
        assertNull(promise.rejected)
        assertEquals(1, context.lifecycleListenerCount())

        context.currentActivity = activityWith("https://aplnk.to/rn11-leg7")
        context.emitHostResume()

        assertEquals("https://aplnk.to/rn11-leg7", promise.value)
        assertEquals(0, context.lifecycleListenerCount())
    }

    @Test
    fun `a parked getInitialURL resolves null when the activity resumes with no link`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)

        val promise = CapturingPromise()
        module.getInitialURL(promise)
        assertEquals(1, context.lifecycleListenerCount())

        context.currentActivity = activityWith(null)
        context.emitHostResume()

        assertNull(promise.value)
        assertEquals(0, context.lifecycleListenerCount())
    }

    @Test
    fun `a warm-start event answers a parked getInitialURL with null, and the event owns the link`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        val activity = activityWith("https://aplnk.to/rn11-leg7")
        context.currentActivity = activity
        module.onNewIntent(activity.intent)

        assertNull(promise.value)
        assertEquals(0, context.lifecycleListenerCount())
    }

    @Test
    fun `getInitialURL is null when the launching intent carries no data`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)
        context.currentActivity = activityWith(null)

        val promise = CapturingPromise()
        module.getInitialURL(promise)

        assertNull(promise.value)
    }
}
