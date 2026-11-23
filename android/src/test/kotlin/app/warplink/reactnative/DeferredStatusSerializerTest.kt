package app.warplink.reactnative

import org.junit.Assert.assertEquals
import org.junit.Test
import app.warplink.DeferredCheckStatus

/** Every native status reaches JavaScript under the name the TypeScript layer reads. */
class DeferredStatusSerializerTest {

    // conformance: WL-S74
    @Test
    fun `each state without a wait is its name alone`() {
        val expected = mapOf(
            DeferredCheckStatus.NotChecked to "notChecked",
            DeferredCheckStatus.Checking to "checking",
            DeferredCheckStatus.Matched to "matched",
            DeferredCheckStatus.NoMatch to "noMatch",
            DeferredCheckStatus.SkippedOldInstall to "skippedOldInstall",
            DeferredCheckStatus.Stopped to "stopped"
        )

        for ((status, name) in expected) {
            assertEquals(mapOf("state" to name), DeferredStatusSerializer.fields(status))
        }
    }

    // conformance: WL-S74
    @Test
    fun `waiting carries the retry time in epoch milliseconds`() {
        val fields = DeferredStatusSerializer.fields(DeferredCheckStatus.Waiting(1_800_000_000_000L))

        assertEquals(mapOf("state" to "waiting", "retryAt" to 1_800_000_000_000L), fields)
    }
}
