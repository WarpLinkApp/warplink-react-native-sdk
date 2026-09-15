package app.warplink.reactnative

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import app.warplink.WarpLink
import app.warplink.WarpLinkDeepLink
import app.warplink.WarpLinkError
import app.warplink.WarpLinkOptions

class WarpLinkModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext),
    ActivityEventListener {

    /**
     * The cold-start link. See InitialUrlBuffer: it is not a plain field
     * because a host can ask for the link before React Native has attached the
     * Activity, and the answer then has to wait for `onHostResume`.
     */
    private val initialUrl = InitialUrlBuffer(reactContext)

    init {
        reactContext.addActivityEventListener(this)
        initialUrl.capture()
    }

    override fun getName(): String = "WarpLinkModule"

    /**
     * The parameters are NOT nullable, and that is load-bearing.
     *
     * `ActivityEventListener` was Java through React Native 0.79, so Kotlin saw
     * `Intent!` and a nullable override compiled. React Native 0.80 rewrote the
     * interface in Kotlin with non-null parameters, and a nullable override then
     * overrides nothing: the bridge stops compiling entirely, on 0.80 and every
     * release after it. Non-null satisfies the whole supported range, because a
     * Java platform type accepts either.
     *
     * Bead: warplink-y0lt.
     */
    override fun onNewIntent(intent: Intent) {
        // A warm-start link belongs to this event and never to getInitialURL.
        // Without this the same url could be delivered twice: once as the
        // event, once as a late cold-start read of the Activity's now-current
        // intent.
        initialUrl.claimedByEvent()
        intent.data?.let { uri ->
            val params = Arguments.createMap().apply {
                putString("url", uri.toString())
            }
            sendEvent("onWarpLinkDeepLink", params)
        }
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        // Not used
    }

    @ReactMethod
    fun getInitialURL(promise: Promise) {
        initialUrl.read(promise)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun configure(config: ReadableMap, promise: Promise) {
        try {
            val apiKey = config.getString("apiKey")
                ?: return promise.reject(
                    "E_INVALID_API_KEY_FORMAT",
                    "apiKey is required"
                )

            val defaults = WarpLinkOptions()
            val options = WarpLinkOptions(
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

            WarpLink.configure(reactApplicationContext, apiKey, options)
            promise.resolve(null)
        } catch (e: Exception) {
            rejectWithError(e, promise)
        }
    }

    @ReactMethod
    fun handleDeepLink(url: String, promise: Promise) {
        try {
            val uri = Uri.parse(url)
            WarpLink.handleDeepLink(uri) { result ->
                result
                    .onSuccess { deepLink ->
                        if (deepLink != null) {
                            promise.resolve(serializeDeepLink(deepLink))
                        } else {
                            promise.resolve(null)
                        }
                    }
                    .onFailure { error ->
                        rejectWithError(error, promise)
                    }
            }
        } catch (e: Exception) {
            rejectWithError(e, promise)
        }
    }

    /**
     * Whether [url] is a WarpLink link the native SDK would claim. Resolves
     * nothing and touches no network.
     *
     * The automatic path in JavaScript asks this BEFORE it stamps its dedupe
     * window or claims a tap, which is what the native SDK does for itself:
     * `AutoLinkHandler.dispatch` returns on `WarpLink.isWarpLinkUri` before
     * `claimLocked`. Learning a url is foreign afterwards, from the
     * `E_INVALID_URL` that `handleDeepLink` rejects with, arrives after the
     * dedupe state has already changed, which is the defect warplink-0csz
     * reports.
     *
     * Never rejects. A string that is not a url at all is not a WarpLink link,
     * and that is `false`, not an error: the caller is asking a yes/no question
     * about a url it did not choose.
     */
    @ReactMethod
    fun isWarpLinkUrl(url: String, promise: Promise) {
        val answer = try {
            WarpLink.isWarpLinkUri(Uri.parse(url))
        } catch (_: Exception) {
            false
        }
        promise.resolve(answer)
    }

    @ReactMethod
    fun checkDeferredDeepLink(promise: Promise) {
        try {
            WarpLink.checkDeferredDeepLink { result ->
                result
                    .onSuccess { deepLink ->
                        if (deepLink != null) {
                            promise.resolve(serializeDeepLink(deepLink))
                        } else {
                            promise.resolve(null)
                        }
                    }
                    .onFailure { error ->
                        rejectWithError(error, promise)
                    }
            }
        } catch (e: Exception) {
            rejectWithError(e, promise)
        }
    }

    @ReactMethod
    fun getAttributionResult(promise: Promise) {
        if (!WarpLink.isConfigured) {
            return promise.reject("E_NOT_CONFIGURED", "SDK not configured")
        }
        val attribution = WarpLink.attributionResult
        if (attribution != null) {
            promise.resolve(serializeDeepLink(attribution))
        } else {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun isConfigured(promise: Promise) {
        promise.resolve(WarpLink.isConfigured)
    }

    /**
     * The native SDK's own version string, not the npm package's.
     *
     * This bridge pins `app.warplink:sdk` by hand, and that pin has drifted
     * before, so a host has to be able to ask what it is actually running.
     */
    @ReactMethod
    fun getSdkVersion(promise: Promise) {
        promise.resolve(WarpLink.SDK_VERSION)
    }

    @ReactMethod
    fun isAttributionComplete(promise: Promise) {
        promise.resolve(WarpLink.isAttributionComplete())
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // No-op. NativeEventEmitter lifecycle stub.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // No-op. NativeEventEmitter lifecycle stub.
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

    private fun serializeDeepLink(link: WarpLinkDeepLink): WritableMap {
        val map = WritableNativeMap()
        map.putString("linkId", link.linkId)
        map.putString("destination", link.destination)
        if (link.deepLinkUrl != null) {
            map.putString("deepLinkUrl", link.deepLinkUrl)
        } else {
            map.putNull("deepLinkUrl")
        }
        map.putMap("customParams", toWritableMap(link.customParams))
        map.putBoolean("isDeferred", link.isDeferred)
        if (link.matchType != null) {
            map.putString("matchType", link.matchType!!.name.lowercase())
        } else {
            map.putNull("matchType")
        }
        if (link.matchConfidence != null) {
            map.putDouble("matchConfidence", link.matchConfidence!!)
        } else {
            map.putNull("matchConfidence")
        }
        map.putBoolean("matchGuaranteed", link.matchGuaranteed)
        return map
    }

    private fun toWritableMap(
        params: Map<String, Any?>
    ): WritableMap {
        val map = WritableNativeMap()
        for ((key, value) in params) {
            when (value) {
                is String -> map.putString(key, value)
                is Boolean -> map.putBoolean(key, value)
                is Int -> map.putInt(key, value)
                // Long and other numerics (e.g. JSON numbers that exceed Int)
                // must not be stringified; deliver them as JS numbers.
                is Number -> map.putDouble(key, value.toDouble())
                is JSONObject -> map.putMap(key, jsonObjectToWritableMap(value))
                is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
                JSONObject.NULL -> map.putNull(key)
                null -> map.putNull(key)
                else -> map.putString(key, value.toString())
            }
        }
        return map
    }

    private fun jsonObjectToWritableMap(json: JSONObject): WritableMap {
        val map = WritableNativeMap()
        for (key in json.keys()) {
            val value = json.get(key)
            when (value) {
                is String -> map.putString(key, value)
                is Boolean -> map.putBoolean(key, value)
                is Int -> map.putInt(key, value)
                is Number -> map.putDouble(key, value.toDouble())
                is JSONObject -> map.putMap(key, jsonObjectToWritableMap(value))
                is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
                JSONObject.NULL -> map.putNull(key)
                else -> map.putString(key, value.toString())
            }
        }
        return map
    }

    private fun jsonArrayToWritableArray(json: JSONArray): WritableArray {
        val array = WritableNativeArray()
        for (i in 0 until json.length()) {
            when (val value = json.get(i)) {
                is String -> array.pushString(value)
                is Boolean -> array.pushBoolean(value)
                is Int -> array.pushInt(value)
                is Number -> array.pushDouble(value.toDouble())
                is JSONObject -> array.pushMap(jsonObjectToWritableMap(value))
                is JSONArray -> array.pushArray(jsonArrayToWritableArray(value))
                JSONObject.NULL -> array.pushNull()
                else -> array.pushString(value.toString())
            }
        }
        return array
    }

    private fun rejectWithError(error: Throwable, promise: Promise) {
        val code = when (error) {
            is WarpLinkError.NotConfigured -> "E_NOT_CONFIGURED"
            is WarpLinkError.InvalidApiKey -> "E_INVALID_API_KEY"
            is WarpLinkError.InvalidApiKeyFormat -> "E_INVALID_API_KEY_FORMAT"
            is WarpLinkError.NetworkError -> "E_NETWORK_ERROR"
            is WarpLinkError.ServerError -> "E_SERVER_ERROR"
            is WarpLinkError.InvalidUrl -> "E_INVALID_URL"
            is WarpLinkError.LinkNotFound -> "E_LINK_NOT_FOUND"
            is WarpLinkError.PasswordRequired -> "E_PASSWORD_REQUIRED"
            is WarpLinkError.DecodingError -> "E_DECODING_ERROR"
            else -> "E_SERVER_ERROR"
        }
        promise.reject(code, error.message, error)
    }
}
