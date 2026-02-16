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
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import app.warplink.sdk.WarpLink
import app.warplink.sdk.WarpLinkDeepLink
import app.warplink.sdk.WarpLinkError
import app.warplink.sdk.WarpLinkOptions

class WarpLinkModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext),
    ActivityEventListener {

    private var initialURL: String? = null

    init {
        reactContext.addActivityEventListener(this)
        reactContext.currentActivity?.intent?.data?.let { uri ->
            initialURL = uri.toString()
        }
    }

    override fun getName(): String = "WarpLinkModule"

    override fun onNewIntent(intent: Intent?) {
        intent?.data?.let { uri ->
            val params = Arguments.createMap().apply {
                putString("url", uri.toString())
            }
            sendEvent("onWarpLinkDeepLink", params)
        }
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        // Not used
    }

    @ReactMethod
    fun getInitialURL(promise: Promise) {
        val url = initialURL
        initialURL = null
        promise.resolve(url)
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

            val options = WarpLinkOptions.Builder().apply {
                if (config.hasKey("apiEndpoint")) {
                    apiEndpoint(config.getString("apiEndpoint")!!)
                }
                if (config.hasKey("debugLogging")) {
                    debugLogging(config.getBoolean("debugLogging"))
                }
                if (config.hasKey("matchWindowHours")) {
                    matchWindowHours(config.getInt("matchWindowHours"))
                }
            }.build()

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
            map.putString("matchType", link.matchType)
        } else {
            map.putNull("matchType")
        }
        if (link.matchConfidence != null) {
            map.putDouble("matchConfidence", link.matchConfidence!!)
        } else {
            map.putNull("matchConfidence")
        }
        return map
    }

    private fun toWritableMap(
        params: Map<String, Any?>
    ): WritableMap {
        val map = WritableNativeMap()
        for ((key, value) in params) {
            when (value) {
                is String -> map.putString(key, value)
                is Int -> map.putInt(key, value)
                is Double -> map.putDouble(key, value)
                is Boolean -> map.putBoolean(key, value)
                null -> map.putNull(key)
                else -> map.putString(key, value.toString())
            }
        }
        return map
    }

    private fun rejectWithError(error: Throwable, promise: Promise) {
        val code = if (error is WarpLinkError) {
            error.code
        } else {
            "E_SERVER_ERROR"
        }
        promise.reject(code, error.message, error)
    }
}
