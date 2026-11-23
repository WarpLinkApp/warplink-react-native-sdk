package app.warplink.reactnative

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import app.warplink.WarpLinkOptions

/** Builds the native options from the config map the JavaScript layer sends. */
internal fun readWarpLinkOptions(config: ReadableMap): WarpLinkOptions {
    val defaults = WarpLinkOptions()
    return WarpLinkOptions(
        apiEndpoint = if (config.hasKey("apiEndpoint"))
            config.getString("apiEndpoint") ?: defaults.apiEndpoint
        else defaults.apiEndpoint,
        debugLogging = if (config.hasKey("debugLogging"))
            config.getBoolean("debugLogging")
        else defaults.debugLogging,
        // The React Native layer owns all cold/warm/deferred dispatch, so
        // the core is opted out of its automatic handling to avoid a
        // double-fire with the TS orchestrator.
        automaticDeepLinks = false,
        automaticDeferredDeepLinks = false,
        // Host-declared custom link domains, passed through untouched.
        // The core normalizes them and unions them with the manifest
        // meta-data and the server list, so JavaScript never has to.
        linkDomains = readLinkDomains(config, defaults.linkDomains),
    )
}

// TypeScript types linkDomains as string[], but an untyped JavaScript caller
// can still send anything, and a positional getString() on a non-string entry
// throws. Read the whole array once and keep the strings: one bad entry drops
// itself instead of failing the entire configure() call.
private fun readStringList(array: ReadableArray?): List<String> =
    array?.toArrayList()?.filterIsInstance<String>() ?: emptyList()

/**
 * `linkDomains` is `string[]` in TypeScript, but a JavaScript caller can hand
 * the bridge a bare string, and `getArray` then throws. The outer catch
 * turned that into E_SERVER_ERROR and left the SDK unconfigured for the
 * whole launch, which misnames the fault and loses every link. One string
 * is one domain. `ReadableMap.getType` is not used because the compile stub
 * in scripts/check-android-bridge.sh does not model it.
 */
private fun readLinkDomains(config: ReadableMap, fallback: List<String>): List<String> {
    if (!config.hasKey("linkDomains")) return fallback
    return try {
        readStringList(config.getArray("linkDomains"))
    } catch (_: Exception) {
        val single = try { config.getString("linkDomains") } catch (_: Exception) { null }
        if (single.isNullOrBlank()) fallback else listOf(single)
    }
}
