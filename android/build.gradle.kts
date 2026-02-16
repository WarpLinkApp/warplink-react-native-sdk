plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.warplink.reactnative"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    lint {
        targetSdk = 35
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }
}

dependencies {
    // React Native — provided by the consuming app
    implementation("com.facebook.react:react-native:+")

    // WarpLink Android SDK — published release
    implementation("app.warplink:sdk:0.1.0")
    // For local development, use project reference instead:
    // implementation(project(":warplink-android-sdk:sdk"))
}
