package app.warplink.reactnative

import com.facebook.react.bridge.Promise
import app.warplink.WarpLinkError

internal fun rejectWithError(error: Throwable, promise: Promise) {
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
