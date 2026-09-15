#!/usr/bin/env bash
# Compile the REAL Android bridge source against the REAL WarpLink SDK.
#
# Companion to check-ios-bridge.sh, and it exists for the same reason: nothing
# else compiles android/src/main/kotlin/.../WarpLinkModule.kt. The package's CI
# is TypeScript-only, and android/build.gradle.kts is consumed by the host app's
# build, never by this repo's, so a bridge referencing a property the core SDK
# does not define passes every check here.
#
# The SDK is substituted from local SOURCE rather than the published artifact,
# which is the point: it catches drift between the bridge and the SDK as it is
# now, not as it was at the last release. React is stubbed, since only a handful
# of its symbols are touched and React drift surfaces in a real app build.
set -euo pipefail

RN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_PATH="${WARPLINK_ANDROID_SDK_PATH:-$(cd "$RN_ROOT/../warplink-android-sdk" && pwd)}"

if [ ! -d "$SDK_PATH/sdk" ]; then
  echo "Android SDK not found at $SDK_PATH. Set WARPLINK_ANDROID_SDK_PATH." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bridge/src/main/kotlin/react"

cat > "$WORK/settings.gradle.kts" <<EOF
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "bridge-check"
include(":bridge")
includeBuild("$SDK_PATH") {
    dependencySubstitution { substitute(module("app.warplink:sdk")).using(project(":sdk")) }
}
EOF

cat > "$WORK/gradle.properties" <<'EOF'
# Robolectric pulls androidx transitively, and AGP refuses to resolve the unit
# test classpath without this.
android.useAndroidX=true
EOF

cat > "$WORK/build.gradle.kts" <<'EOF'
plugins {
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
EOF

# Mirror the real android/build.gradle.kts, minus the React artifact.
cat > "$WORK/bridge/build.gradle.kts" <<'EOF'
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "app.warplink.reactnative"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets { getByName("main") { java.srcDirs("src/main/kotlin") } }
}
android {
    testOptions { unitTests.isIncludeAndroidResources = true }
}
dependencies {
    implementation("app.warplink:sdk:1.1.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
EOF

cat > "$WORK/bridge/src/main/kotlin/react/React.kt" <<'EOF'
// Stand-ins for the only React Native symbols the bridge touches.
package com.facebook.react.bridge

import android.app.Activity
import android.content.Context
import android.content.Intent

interface ReadableMap {
    fun hasKey(name: String): Boolean
    fun getString(name: String): String?
    fun getBoolean(name: String): Boolean
    fun getDouble(name: String): Double
    fun getMap(name: String): ReadableMap?
    fun getArray(name: String): ReadableArray?
    fun toHashMap(): HashMap<String, Any>
}
// Mirrors the real hierarchy (WritableArray extends ReadableArray) so the bridge
// cannot compile here against a shape React Native does not actually offer.
interface ReadableArray {
    fun toArrayList(): ArrayList<Any>
}
interface WritableMap : ReadableMap {
    fun putString(key: String, value: String?)
    fun putBoolean(key: String, value: Boolean)
    fun putDouble(key: String, value: Double)
    fun putInt(key: String, value: Int)
    fun putNull(key: String)
    fun putMap(key: String, value: WritableMap?)
    fun putArray(key: String, value: WritableArray?)
}
interface WritableArray : ReadableArray {
    fun pushString(value: String?)
    fun pushMap(value: WritableMap?)
    fun pushBoolean(value: Boolean)
    fun pushInt(value: Int)
    fun pushDouble(value: Double)
    fun pushArray(value: WritableArray?)
    fun pushNull()
}
class WritableNativeMap : WritableMap {
    override fun hasKey(name: String) = false
    override fun getString(name: String): String? = null
    override fun getBoolean(name: String) = false
    override fun getDouble(name: String) = 0.0
    override fun getMap(name: String): ReadableMap? = null
    override fun getArray(name: String): ReadableArray? = null
    override fun toHashMap() = HashMap<String, Any>()
    override fun putString(key: String, value: String?) {}
    override fun putBoolean(key: String, value: Boolean) {}
    override fun putDouble(key: String, value: Double) {}
    override fun putInt(key: String, value: Int) {}
    override fun putNull(key: String) {}
    override fun putMap(key: String, value: WritableMap?) {}
    override fun putArray(key: String, value: WritableArray?) {}
}
class WritableNativeArray : WritableArray {
    override fun toArrayList() = ArrayList<Any>()
    override fun pushString(value: String?) {}
    override fun pushMap(value: WritableMap?) {}
    override fun pushBoolean(value: Boolean) {}
    override fun pushInt(value: Int) {}
    override fun pushDouble(value: Double) {}
    override fun pushArray(value: WritableArray?) {}
    override fun pushNull() {}
}
object Arguments {
    @JvmStatic fun createMap(): WritableMap = WritableNativeMap()
    @JvmStatic fun createArray(): WritableArray = WritableNativeArray()
}
interface Promise {
    fun resolve(value: Any?)
    fun reject(code: String, message: String?)
    fun reject(code: String, message: String?, throwable: Throwable?)
}
// The real one is a ContextWrapper, and the bridge passes it straight to
// WarpLink.configure(context), so the stub has to be a Context too.
open class ReactApplicationContext(base: Context) : android.content.ContextWrapper(base) {
    open var currentActivity: Activity? = null
    open fun addActivityEventListener(listener: ActivityEventListener) {}
    open fun addLifecycleEventListener(listener: LifecycleEventListener) {}
    open fun removeLifecycleEventListener(listener: LifecycleEventListener) {}
    open fun <T> getJSModule(type: Class<T>): T = throw UnsupportedOperationException()
}
// Non-null parameters, because React Native 0.82 rewrote this interface in
// Kotlin and made them non-null. The stub models the React Native the SDK
// supports, not the one it was written against. See the real-artifact matrix
// below, which is what proves the stub is not lying.
interface ActivityEventListener {
    fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?)
    fun onNewIntent(intent: Intent)
}
// React Native's own Linking module parks getInitialURL on this when the
// Activity is not attached yet, so the bridge needs it for the same reason.
interface LifecycleEventListener {
    fun onHostResume()
    fun onHostPause()
    fun onHostDestroy()
}
interface NativeModule
abstract class ReactContextBaseJavaModule(
    protected val reactApplicationContext: ReactApplicationContext
) : NativeModule {
    abstract fun getName(): String
}
annotation class ReactMethod(val isBlockingSynchronousMethod: Boolean = false)
EOF

cat > "$WORK/bridge/src/main/kotlin/react/Package.kt" <<'EOF'
package com.facebook.react

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

interface ReactPackage {
    fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule>
    fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>>
}
EOF

cat > "$WORK/bridge/src/main/kotlin/react/ViewManager.kt" <<'EOF'
package com.facebook.react.uimanager

abstract class ViewManager<T, C>
EOF

cat > "$WORK/bridge/src/main/kotlin/react/DeviceEvent.kt" <<'EOF'
package com.facebook.react.modules.core

interface DeviceEventManagerModule {
    interface RCTDeviceEventEmitter {
        fun emit(eventName: String, data: Any?)
    }
}
EOF

mkdir -p "$WORK/bridge/src/main/kotlin/app/warplink/reactnative"
cp "$RN_ROOT/android/src/main/kotlin/app/warplink/reactnative/"*.kt \
   "$WORK/bridge/src/main/kotlin/app/warplink/reactnative/"

# The bridge's own unit tests run against the same stubs. Compiling the bridge
# proves it still fits the SDK; these prove it still behaves, which is what the
# cold-start defect (warplink-15uj) needed and no check here had.
if [ -d "$RN_ROOT/android/src/test/kotlin" ]; then
  mkdir -p "$WORK/bridge/src/test/kotlin"
  cp -R "$RN_ROOT/android/src/test/kotlin/." "$WORK/bridge/src/test/kotlin/"
fi
cp "$SDK_PATH/gradlew" "$WORK/" 2>/dev/null || true
cp -R "$SDK_PATH/gradle" "$WORK/" 2>/dev/null || true

cd "$WORK"
./gradlew :bridge:compileDebugKotlin --quiet 2>&1
echo "Android bridge compiles against the real WarpLink SDK."

if [ -d "$WORK/bridge/src/test/kotlin" ]; then
  # --rerun-tasks: a cached green here would say nothing about the source that
  # was just copied in.
  ./gradlew :bridge:testDebugUnitTest --rerun-tasks --console=plain 2>&1 | tail -20
  # Never trust the console summary alone. Parse the XML and require every file
  # to carry failures="0", the same rule the Android SDK suite follows.
  RESULTS="$WORK/bridge/build/test-results/testDebugUnitTest"
  if [ ! -d "$RESULTS" ] || [ -z "$(ls -A "$RESULTS"/*.xml 2>/dev/null)" ]; then
    echo "No Android bridge test results were produced." >&2
    exit 1
  fi
  if grep -L 'failures="0"' "$RESULTS"/*.xml | grep -q .; then
    echo "Android bridge unit tests failed." >&2
    exit 1
  fi
  if grep -L 'errors="0"' "$RESULTS"/*.xml | grep -q .; then
    echo "Android bridge unit tests errored." >&2
    exit 1
  fi
  echo "Android bridge unit tests pass."
fi

# --- The bridge compiles against the React Native versions it claims ---------
#
# The block above compiles against hand-written stubs, which is fast and needs
# no network, and which is exactly why it cannot catch React Native changing an
# interface. It did not: `ActivityEventListener` was Java through 0.79, so Kotlin
# saw `Intent!` and a nullable override compiled; 0.80 rewrote it in Kotlin with
# non-null parameters and the bridge stopped compiling on 0.80 and everything
# after it (warplink-y0lt). The stub said it was fine for a year.
#
# So the bridge is also compiled against the REAL artifact, at both ends of the
# range package.json declares: the oldest supported React Native and the newest
# stable one. `com.facebook.react:react-android` is the coordinate React Native
# publishes to Maven Central; `com.facebook.react:react-native` stopped at
# 0.71.0-rc.0 and only resolves inside an app because React Native's own Gradle
# plugin substitutes it.
#
# Override the matrix for a one-off check:
#   WARPLINK_RN_MATRIX="0.79.7 0.86.3" scripts/check-android-bridge.sh
RN_MATRIX="${WARPLINK_RN_MATRIX:-0.75.5 0.86.3}"

mkdir -p "$WORK/real/bridge/src/main/kotlin/app/warplink/reactnative"
cp "$RN_ROOT/android/src/main/kotlin/app/warplink/reactnative/"*.kt \
   "$WORK/real/bridge/src/main/kotlin/app/warplink/reactnative/"

cat > "$WORK/real/settings.gradle.kts" <<EOF
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "bridge-check-real"
include(":bridge")
includeBuild("$SDK_PATH") {
    dependencySubstitution { substitute(module("app.warplink:sdk")).using(project(":sdk")) }
}
EOF

cat > "$WORK/real/gradle.properties" <<'EOF'
android.useAndroidX=true
org.gradle.jvmargs=-Xmx2048m
EOF

cat > "$WORK/real/build.gradle.kts" <<'EOF'
plugins {
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
EOF

cp "$SDK_PATH/gradlew" "$WORK/real/" 2>/dev/null || true
cp -R "$SDK_PATH/gradle" "$WORK/real/" 2>/dev/null || true

for RN_VERSION in $RN_MATRIX; do
  cat > "$WORK/real/bridge/build.gradle.kts" <<EOF
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "app.warplink.reactnative"
    // Matches what Expo SDK 57 and React Native 0.86 build a host app at.
    // Measured, not assumed: react-android 0.86.3 also resolves at compileSdk
    // 35, so this is alignment with the host rather than a requirement.
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets { getByName("main") { java.srcDirs("src/main/kotlin") } }
}
dependencies {
    // compileOnly, the way a React Native library consumes React Native: the
    // host app supplies it at runtime.
    compileOnly("com.facebook.react:react-android:$RN_VERSION")
    implementation("app.warplink:sdk:1.1.0")
}
EOF
  ( cd "$WORK/real" && ./gradlew :bridge:compileDebugKotlin --rerun-tasks --quiet 2>&1 )
  echo "Android bridge compiles against React Native $RN_VERSION."
done
