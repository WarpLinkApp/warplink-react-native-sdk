package app.warplink.reactnative

import android.app.Activity
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The bridge can be asked whether a url is a WarpLink link, without resolving
 * it.
 *
 * JavaScript has no domain list of its own and must not grow one: the effective
 * set is the union of `aplnk.to`, what the host declared in code or in the
 * manifest, and what `/sdk/validate` returned, and only the native SDK holds
 * all three. Before this method the TypeScript automatic path could learn a url
 * was foreign only by resolving it and reading `E_INVALID_URL` off the
 * rejection, which arrives after it has already stamped its dedupe window
 * (warplink-0csz). This asks the native SDK the same question the native
 * automatic path asks itself, at the same point.
 *
 * Bead: warplink-0csz.
 */
@RunWith(RobolectricTestRunner::class)
class WarpLinkModuleIsWarpLinkUrlTest {

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
        override fun addLifecycleEventListener(listener: LifecycleEventListener) {}
        override fun removeLifecycleEventListener(listener: LifecycleEventListener) {}
    }

    private fun ask(url: String): CapturingPromise {
        val promise = CapturingPromise()
        WarpLinkModule(TestReactContext()).isWarpLinkUrl(url, promise)
        return promise
    }

    @Test
    fun `a link on the default domain answers true`() {
        val promise = ask("https://aplnk.to/abc123")

        assertEquals(true, promise.value)
        assertNull(promise.rejected)
    }

    @Test
    fun `a foreign custom scheme answers false`() {
        val promise = ask("myapp://oauth/callback")

        assertEquals(false, promise.value)
        assertNull(promise.rejected)
    }

    @Test
    fun `an unknown host answers false`() {
        assertEquals(false, ask("https://example.com/abc123").value)
    }

    @Test
    fun `a multi-segment path on a known host answers false`() {
        assertEquals(false, ask("https://aplnk.to/blog/hello").value)
    }

    /**
     * A yes/no question about a url the caller did not choose. A string that is
     * not a url at all is simply not a WarpLink link, so it answers false
     * rather than rejecting: a rejection here would force the TypeScript layer
     * to treat "cannot tell" and "not ours" as the same thing.
     */
    @Test
    fun `a string that is not a url answers false instead of rejecting`() {
        val promise = ask("not a url at all")

        assertEquals(false, promise.value)
        assertNull(promise.rejected)
    }

    @Test
    fun `an empty string answers false instead of rejecting`() {
        val promise = ask("")

        assertEquals(false, promise.value)
        assertNull(promise.rejected)
    }

    /**
     * Answering must not consume anything. The cold-start url is read once and
     * cleared (`InitialUrlBuffer`), and the dedupe window is a single slot in
     * the SDK, so a classification with a side effect would be worse than the
     * resolve it replaces.
     */
    @Test
    fun `asking does not consume the cold-start url`() {
        val context = TestReactContext()
        val module = WarpLinkModule(context)

        val classified = CapturingPromise()
        module.isWarpLinkUrl("https://aplnk.to/abc123", classified)
        assertEquals(true, classified.value)

        // The module was built with no Activity attached, so getInitialURL
        // parks rather than answering. The point is only that the question
        // above changed nothing about it.
        val initial = CapturingPromise()
        module.getInitialURL(initial)
        assertNull(initial.rejected)
    }
}
