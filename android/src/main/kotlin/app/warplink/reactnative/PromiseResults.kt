package app.warplink.reactnative

import android.net.Uri
import com.facebook.react.bridge.Promise
import app.warplink.WarpLink
import app.warplink.WarpLinkDeepLink
import app.warplink.WarpLinkError

/** Runs [block] and rejects [promise] with the mapped code when it throws. */
internal inline fun guarded(promise: Promise, block: () -> Unit) {
    try {
        block()
    } catch (e: Exception) {
        rejectWithError(e, promise)
    }
}

/** Resolves [promise] with the serialized success, or rejects it with the mapped code. */
internal fun <T> Result<T>.settleWith(promise: Promise, serialize: (T) -> Any?) {
    onSuccess { promise.resolve(serialize(it)) }
        .onFailure { rejectWithError(it, promise) }
}

/** A deep link answer: the link when there is one, null when there is none. */
internal fun Result<WarpLinkDeepLink?>.settleDeepLink(promise: Promise) {
    settleWith(promise) { link -> link?.let { serializeDeepLink(it) } }
}

/**
 * The native SDK reports a stored item it could not delete as a decoding
 * error with a plain message; here it is the storage code.
 */
internal fun rejectClearFailure(error: Throwable, promise: Promise) {
    if (error is WarpLinkError.DecodingError) {
        promise.reject("E_STORAGE_ERROR", error.cause?.message ?: error.message, error)
    } else {
        rejectWithError(error, promise)
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
 * Never throws. A string that is not a url at all is not a WarpLink link,
 * and that is `false`, not an error: the caller is asking a yes/no question
 * about a url it did not choose.
 */
internal fun isWarpLinkUrlOrFalse(url: String): Boolean =
    try {
        WarpLink.isWarpLinkUri(Uri.parse(url))
    } catch (_: Exception) {
        false
    }
