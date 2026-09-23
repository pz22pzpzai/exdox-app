# Project-specific R8 keep rules for optimized Android builds.

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Native fbjni code looks up this field by its original name at runtime.
# Keep it on live bridge classes, including React Native's debug inspector.
-keepclassmembers class * {
    com.facebook.jni.HybridData mHybridData;
}

# Add any project specific keep options here:
