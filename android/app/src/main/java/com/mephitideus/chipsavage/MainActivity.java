package com.mephitideus.chipsavage;

import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Gameplay has no regular touches during cutscenes/boss intros, so
        // stop the screen from dimming or locking mid-level.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBack();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Dialogs, the notification shade and app switching restore the bars.
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    public void onPause() {
        super.onPause();
        // main.js listens for these to pause gameplay and suspend audio.
        if (bridge != null) bridge.triggerDocumentJSEvent("pause");
    }

    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null) bridge.triggerDocumentJSEvent("resume");
    }

    private void enterImmersiveMode() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    /** Lets the game consume Back (pause, close menus) before falling back. */
    private void handleBack() {
        final WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return !!(window.__chipNativeBack&&window.__chipNativeBack());}catch(e){return false;}})()",
            (result) -> {
                if ("true".equals(result)) return;
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        );
    }
}
