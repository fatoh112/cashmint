plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android { namespace = "com.cashmint.paymentbridge"; compileSdk = 35
    defaultConfig { applicationId = "com.cashmint.paymentbridge"; minSdk = 26; targetSdk = 35; versionCode = 9; versionName = "1.0.8" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.stripe:stripeterminal:5.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
