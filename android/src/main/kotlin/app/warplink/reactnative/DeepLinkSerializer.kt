package app.warplink.reactnative

import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONArray
import org.json.JSONObject
import app.warplink.WarpLinkDeepLink

internal fun serializeDeepLink(link: WarpLinkDeepLink): WritableMap {
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
    ReferralSerializer.putEvidence(map, link, ::toWritableMap)
    return map
}

internal fun toWritableMap(
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
