package app.warplink.reactnative

import android.app.Activity
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import app.warplink.TetherReadResult

/**
 * The Tether calls on the Android bridge. Android reads no clipboard, so the
 * only answer is "no code" with no reason, and the bridge must still reject
 * `E_NOT_CONFIGURED` before `configure` so a host sees the same failure on
 * both platforms.
 */
@RunWith(RobolectricTestRunner::class)
class WarpLinkModuleTetherTest {

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

    private fun module() = WarpLinkModule(TestReactContext())

    @Test
    fun `no clipboard is a no-code answer with no reason`() {
        val fields = TetherSerializer.fields(TetherReadResult.NoClipboard)

        assertEquals("noCode", fields["kind"])
        assertEquals(true, fields.containsKey("reason"))
        assertNull(fields["reason"])
    }

    @Test
    fun `reading before configure rejects as not configured`() {
        val promise = CapturingPromise()

        module().readTether(promise)
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("E_NOT_CONFIGURED", promise.rejected)
        assertNull(promise.value)
    }

    @Test
    fun `no test receipt resolves null and never rejects`() {
        val promise = CapturingPromise()

        module().getTetherTestReceipt(promise)

        assertNull(promise.value)
        assertNull(promise.rejected)
    }
}
