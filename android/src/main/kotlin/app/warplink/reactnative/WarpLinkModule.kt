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
import com.facebook.react.modules.core.DeviceEventManagerModule
import app.warplink.WarpLink

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
            WarpLink.configure(reactApplicationContext, apiKey, readWarpLinkOptions(config))
            promise.resolve(null)
        } catch (e: Exception) {
            rejectWithError(e, promise)
        }
    }

    @ReactMethod
    fun handleDeepLink(url: String, promise: Promise) = guarded(promise) {
        WarpLink.handleDeepLink(Uri.parse(url)) { it.settleDeepLink(promise) }
    }

    /** Never rejects. See [isWarpLinkUrlOrFalse]. */
    @ReactMethod
    fun isWarpLinkUrl(url: String, promise: Promise) {
        promise.resolve(isWarpLinkUrlOrFalse(url))
    }

    @ReactMethod
    fun checkDeferredDeepLink(promise: Promise) = guarded(promise) {
        WarpLink.checkDeferredDeepLink { it.settleDeepLink(promise) }
    }

    @ReactMethod
    fun getAttributionResult(promise: Promise) {
        if (!WarpLink.isConfigured) {
            return promise.reject("E_NOT_CONFIGURED", "SDK not configured")
        }
        promise.resolve(WarpLink.attributionResult?.let { serializeDeepLink(it) })
    }

    /**
     * Hands pasted text to the native SDK. The native SDK decides whether the
     * text is an invitation, whether it has expired, and whether to keep it for
     * a later launch. Resolves null when the text is not an invitation.
     */
    @ReactMethod
    fun redeemInvitation(text: String, promise: Promise) = guarded(promise) {
        WarpLink.redeemInvitation(text) { it.settleDeepLink(promise) }
    }

    /**
     * Claims the referral behind this install. Status none is an answer, not
     * an error, so it resolves like any other status.
     */
    @ReactMethod
    fun claimReferral(installerId: String, promise: Promise) = guarded(promise) {
        WarpLink.claimReferral(installerId) {
            it.settleWith(promise, ReferralSerializer::serializeClaim)
        }
    }

    /**
     * Android reads no clipboard, so this resolves "no code" with no reason.
     * It still rejects `E_NOT_CONFIGURED` before `configure`, like iOS.
     */
    @ReactMethod
    fun readTether(promise: Promise) = guarded(promise) {
        WarpLink.readTether { it.settleWith(promise, TetherSerializer::serialize) }
    }

    /** The receipt of the last Tether test code, held in native memory only. */
    @ReactMethod
    fun getTetherTestReceipt(promise: Promise) {
        promise.resolve(WarpLink.lastTetherTestReceipt)
    }

    @ReactMethod
    fun isConfigured(promise: Promise) {
        promise.resolve(WarpLink.isConfigured)
    }

    /**
     * The native SDK's own version string, not the npm package's. The pin of
     * `app.warplink:sdk` has drifted before, so a host can ask what it runs.
     */
    @ReactMethod
    fun getSdkVersion(promise: Promise) {
        promise.resolve(WarpLink.SDK_VERSION)
    }

    @ReactMethod
    fun isAttributionComplete(promise: Promise) {
        promise.resolve(WarpLink.isAttributionComplete())
    }

    /** Read-only: sends no request. Before `configure` the SDK answers `NotChecked`. */
    @ReactMethod
    fun getDeferredCheckStatus(promise: Promise) {
        promise.resolve(DeferredStatusSerializer.serialize(WarpLink.deferredCheckStatus))
    }

    @ReactMethod
    fun clearAttribution(promise: Promise) {
        WarpLink.clearAttribution()
            .onSuccess { promise.resolve(null) }
            .onFailure { rejectClearFailure(it, promise) }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // No-op. NativeEventEmitter lifecycle stub.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // No-op. NativeEventEmitter lifecycle stub.
    }
}
