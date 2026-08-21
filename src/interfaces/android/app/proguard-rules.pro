# Keep methods exposed to the trusted /mobile WebView if shrinking is enabled.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
