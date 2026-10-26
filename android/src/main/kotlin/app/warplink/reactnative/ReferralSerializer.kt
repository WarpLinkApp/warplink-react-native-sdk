package app.warplink.reactnative

import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import app.warplink.ReferralClaimResult
import app.warplink.WarpLinkDeepLink

/**
 * The referral handoff, lowered to maps JavaScript can read. The native SDK
 * owns every decision; this only names the fields. A value the bridge cannot
 * name is sent as null, and JavaScript reads null as its safe default.
 */
internal object ReferralSerializer {

    /**
     * Adds the additive evidence fields of a match to [map]. [lowerParams]
     * turns the captured parameters into a map React Native can carry, the
     * same way the module lowers `customParams`.
     */
    fun putEvidence(
        map: WritableMap,
        link: WarpLinkDeepLink,
        lowerParams: (Map<String, Any?>) -> WritableMap
    ) {
        putNullableString(map, "attributionId", link.attributionId)
        putNullableString(map, "matchMethod", link.matchMethod?.wireValue)
        putNullableString(map, "evidenceClass", link.evidenceClass?.wireValue)
        putNullableString(map, "replayState", link.replayState?.wireValue)
        map.putMap("capturedParams", lowerParams(link.capturedParams))
        putNullableString(map, "tappedAt", link.tappedAt)
    }

    fun serializeClaim(claim: ReferralClaimResult): WritableMap {
        val map = WritableNativeMap()
        map.putString("status", claim.status.wireValue)
        putNullableString(map, "referralId", claim.referralId)
        putNullableString(map, "linkId", claim.linkId)
        putNullableString(map, "linkUrl", claim.linkUrl)
        putNullableString(map, "matchMethod", claim.matchMethod?.wireValue)
        map.putBoolean("isExact", claim.isExact)
        val confidence = claim.matchConfidence
        if (confidence != null) map.putDouble("matchConfidence", confidence) else map.putNull("matchConfidence")
        val flags = WritableNativeArray()
        claim.flags.forEach { flags.pushString(it) }
        map.putArray("flags", flags)
        putNullableString(map, "duplicateOf", claim.duplicateOf)
        map.putBoolean("updated", claim.updated)
        putNullableString(map, "replayState", claim.replayState?.wireValue)
        return map
    }

    private fun putNullableString(map: WritableMap, key: String, value: String?) {
        if (value != null) map.putString(key, value) else map.putNull(key)
    }
}
