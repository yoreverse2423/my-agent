package com.xiaoxuexiji.watch;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentCallbacks2;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * WebView shell for Yore's agent. Ships offline www assets; GitHub sync and
 * DeepSeek chat need network. DeepSeek goes through a JavascriptInterface
 * + HttpURLConnection path so ColorOS WebView CORS cannot block it.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final String DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int HTTP_TIMEOUT_MS = 18000;
    private static final int HTTP_MAX_CHARS = 700000;

    static {
        try {
            System.loadLibrary("xiaoxuexiji");
        } catch (Throwable ignored) {
        }
    }

    private static final String ERROR_HOOK_JS =
            "(function(){if(window.__shErrorHook)return;window.__shErrorHook=true;"
                    + "window.addEventListener('error',function(e){try{"
                    + "console.error('[studyhub]',(e&&e.message)||e);"
                    + "}catch(_){}},true);})();";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean fallbackShown;
    private final ExecutorService netExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            try {
                getWindow().setFlags(
                        WindowManager.LayoutParams.FLAG_FULLSCREEN,
                        WindowManager.LayoutParams.FLAG_FULLSCREEN
                );
            } catch (Throwable ignored) {
            }
            getWindow().setBackgroundDrawableResource(android.R.color.black);
            hideSystemUi();

            FrameLayout root = new FrameLayout(this);
            root.setBackgroundColor(Color.rgb(244, 241, 232));
            setContentView(root);

            webView = createWebView();
            root.addView(webView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
            ));

            if (savedInstanceState != null) {
                try {
                    webView.restoreState(savedInstanceState);
                } catch (Throwable ignored) {
                }
                if (webView.getUrl() == null) {
                    loadStartPage();
                }
            } else {
                loadStartPage();
            }
        } catch (Throwable error) {
            showFallback(error);
        }
    }

    private WebView createWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.rgb(244, 241, 232));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.setVerticalScrollBarEnabled(false);
        view.setHorizontalScrollBarEnabled(false);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            // ColorOS 系统默认黄色焦点高亮，CSS 去不掉。
            view.setDefaultFocusHighlightEnabled(false);
        }

        configureWebView(view);
        view.addJavascriptInterface(new StudyHubBridge(), "StudyHubNative");
        view.setWebViewClient(new AppWebViewClient());
        view.setWebChromeClient(new AppChromeClient());
        return view;
    }

    private void loadStartPage() {
        try {
            webView.loadUrl(START_URL);
        } catch (Throwable error) {
            showFallback(error);
        }
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        if (settings == null) {
            throw new IllegalStateException("WebSettings is null");
        }
        try {
            settings.setDatabasePath(getDir("webview_db", MODE_PRIVATE).getPath());
        } catch (Throwable ignored) {
        }
        safeSet(settings, () -> settings.setJavaScriptEnabled(true));
        safeSet(settings, () -> settings.setDomStorageEnabled(true));
        safeSet(settings, () -> settings.setDatabaseEnabled(true));
        safeSet(settings, () -> settings.setAllowFileAccess(true));
        safeSet(settings, () -> settings.setAllowContentAccess(true));
        safeSet(settings, () -> settings.setAllowFileAccessFromFileURLs(true));
        safeSet(settings, () -> settings.setAllowUniversalAccessFromFileURLs(true));
        safeSet(settings, () -> settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW));
        safeSet(settings, () -> settings.setMediaPlaybackRequiresUserGesture(false));
        safeSet(settings, () -> settings.setSupportMultipleWindows(false));
        safeSet(settings, () -> settings.setJavaScriptCanOpenWindowsAutomatically(false));
        safeSet(settings, () -> settings.setUseWideViewPort(true));
        safeSet(settings, () -> settings.setLoadWithOverviewMode(true));
        safeSet(settings, () -> settings.setSupportZoom(false));
        safeSet(settings, () -> settings.setBuiltInZoomControls(false));
        safeSet(settings, () -> settings.setDisplayZoomControls(false));
        safeSet(settings, () -> settings.setTextZoom(100));
        safeSet(settings, () -> settings.setCacheMode(WebSettings.LOAD_DEFAULT));
        safeSet(settings, () -> settings.setGeolocationEnabled(false));
        safeSet(settings, () -> settings.setDefaultTextEncodingName("UTF-8"));
    }

    private interface SettingsOp {
        void run() throws Throwable;
    }

    private void safeSet(WebSettings ignored, SettingsOp op) {
        try {
            op.run();
        } catch (Throwable ignoredErr) {
        }
    }

    private void hideSystemUi() {
        // Intentionally empty on ColorOS Watch.
    }

    private void showFallback(Throwable error) {
        if (fallbackShown || isFinishing()) return;
        fallbackShown = true;

        try {
            if (webView != null) {
                try { webView.stopLoading(); } catch (Throwable ignored) {}
                try {
                    ViewGroup parent = (ViewGroup) webView.getParent();
                    if (parent != null) parent.removeView(webView);
                } catch (Throwable ignored) {}
                try { webView.destroy(); } catch (Throwable ignored) {}
                webView = null;
            }
        } catch (Throwable ignored) {
            webView = null;
        }

        String code = error == null ? "" : error.getClass().getSimpleName();
        String message = "Yore's agent 未能启动\n\n"
                + "手表 WebView 初始化或页面加载失败。\n"
                + "请重启手表后再打开本应用。\n"
                + "若仍然失败，请卸载后重新安装。";
        if (error != null) {
            try {
                String detail = error.getMessage();
                if (detail != null && !detail.isEmpty()) {
                    message += "\n\n详情: " + detail;
                }
            } catch (Throwable ignored) {
            }
        }
        if (!code.isEmpty()) {
            message += "\n\n错误代码: " + code;
        }

        TextView panel = new TextView(this);
        panel.setText(message);
        panel.setTextColor(Color.rgb(255, 253, 248));
        panel.setBackgroundColor(Color.rgb(13, 107, 87));
        panel.setTextSize(15);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(28, 28, 28, 28);
        panel.setLineSpacing(4, 1f);

        try {
            setContentView(panel);
        } catch (Throwable ignored) {
        }
    }

    private boolean handleUrl(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }
        scheme = scheme.toLowerCase();

        if ("file".equals(scheme)) {
            String path = uri.getPath();
            if (path == null) {
                return true; // block unknown
            }
            String lower = path.toLowerCase();
            if (lower.endsWith(".apk")) {
                showToast("手表版已随应用安装；重装请从网页版下载到电脑后 ADB 安装");
                return true;
            }
            // Only packaged assets may load in this WebView.
            if (path.contains("/android_asset/")) {
                return false;
            }
            showToast("Yore's agent 仅加载应用内页面");
            return true;
        }

        if ("about".equals(scheme)
                || "blob".equals(scheme)
                || "data".equals(scheme)
                || "javascript".equals(scheme)) {
            return false;
        }

        // Block navigating the shell to arbitrary sites while StudyHubNative is injected.
        // XHR/fetch to GitHub/DeepSeek still works from local JS.
        if ("http".equals(scheme) || "https".equals(scheme)) {
            showToast("Yore's agent 仅使用本地页面；网络请求由应用内接口完成");
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            showToast("无法打开此链接");
        }
        return true;
    }

    private void showToast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    /** Bridge used by app.js: window.StudyHubNative.deepseekChat(id, cbName, json) */
    private final class StudyHubBridge {
        @JavascriptInterface
        public void deepseekChat(String requestId, String callbackName, String jsonBody) {
            final String cb = sanitizeCallback(callbackName);
            netExecutor.execute(() -> {
                String err = null;
                String resultJson = null;
                try {
                    resultJson = postDeepseek(jsonBody);
                } catch (Throwable t) {
                    err = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
                }
                final String errFinal = err;
                final String resultFinal = resultJson;
                mainHandler.post(() -> deliverCallback(cb, errFinal, resultFinal));
            });
        }

        /** Plain https GET for search providers (Bing HTML) so WebView CORS doesn't block it. */
        @JavascriptInterface
        public void httpGet(String requestId, String callbackName, String url) {
            final String cb = sanitizeCallback(callbackName);
            netExecutor.execute(() -> {
                String err = null;
                String result = null;
                try {
                    result = getText(url);
                } catch (Throwable t) {
                    err = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
                }
                final String errFinal = err;
                final String resultFinal = result;
                mainHandler.post(() -> deliverCallback(cb, errFinal, resultFinal));
            });
        }

        @JavascriptInterface
        public String ping() {
            return "studyhub-native";
        }
    }

    private String sanitizeCallback(String name) {
        if (name == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '_' || c == '$') {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private void deliverCallback(String callbackName, String err, String resultJson) {
        if (webView == null || callbackName == null || callbackName.isEmpty()) return;
        try {
            String errLit = err == null ? "null" : JSONObject.quote(err);
            String dataLit = err != null ? "null" : JSONObject.quote(resultJson == null ? "" : resultJson);
            String js = "(function(){try{var fn=window[" + JSONObject.quote(callbackName) + "];"
                    + "if(typeof fn==='function')fn(" + errLit + "," + dataLit + ");"
                    + "}catch(e){console.error(e);}})();";
            webView.evaluateJavascript(js, null);
        } catch (Throwable ignored) {
        }
    }

    private String getText(String rawUrl) throws Exception {
        String url = rawUrl == null ? "" : rawUrl.trim();
        if (url.isEmpty()) throw new IllegalArgumentException("缺少 url");
        URL parsed = new URL(url);
        if (!"https".equalsIgnoreCase(parsed.getProtocol())) {
            throw new IllegalArgumentException("只允许 https");
        }
        HttpURLConnection conn = (HttpURLConnection) parsed.openConnection();
        conn.setConnectTimeout(HTTP_TIMEOUT_MS);
        conn.setReadTimeout(HTTP_TIMEOUT_MS);
        conn.setRequestMethod("GET");
        conn.setInstanceFollowRedirects(true);
        // Desktop Chrome UA: Bing mobile HTML often omits real titles; desktop still returns h2 titles.
        conn.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
        conn.setRequestProperty("Accept", "text/html,application/json;q=0.9,*/*;q=0.8");
        conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6");

        int code = conn.getResponseCode();
        // HttpURLConnection may follow redirects; only https targets are allowed.
        URL finalUrl = conn.getURL();
        if (finalUrl == null || !"https".equalsIgnoreCase(finalUrl.getProtocol())) {
            throw new IllegalArgumentException("只允许 https");
        }
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String body = readText(stream, HTTP_MAX_CHARS);
        if (code >= 400) throw new IllegalStateException("HTTP " + code);
        return body;
    }

    private static String readText(InputStream stream, int maxChars) throws Exception {
        if (stream == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
                if (sb.length() >= maxChars) break;
            }
        }
        if (sb.length() > maxChars) sb.setLength(maxChars);
        return sb.toString();
    }

    private String postDeepseek(String jsonBody) throws Exception {
        JSONObject incoming = new JSONObject(jsonBody == null ? "{}" : jsonBody);
        String apiKey = incoming.optString("apiKey", "");
        if (apiKey.isEmpty()) {
            throw new IllegalArgumentException("缺少 apiKey");
        }
        JSONObject outbound = new JSONObject();
        outbound.put("model", incoming.optString("model", "deepseek-flash"));
        outbound.put("messages", incoming.getJSONArray("messages"));
        if (incoming.has("temperature") && !incoming.isNull("temperature")) {
            outbound.put("temperature", incoming.getDouble("temperature"));
        }

        byte[] payload = outbound.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = (HttpURLConnection) new URL(DEEPSEEK_URL).openConnection();
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(120000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        conn.setRequestProperty("Accept", "application/json");
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload);
        }

        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String body = readFully(stream);
        if (code >= 400) {
            String msg = "HTTP " + code;
            try {
                JSONObject err = new JSONObject(body);
                if (err.has("error")) {
                    JSONObject e = err.optJSONObject("error");
                    if (e != null && e.has("message")) msg = e.optString("message", msg);
                } else if (err.has("message")) {
                    msg = err.optString("message", msg);
                }
            } catch (Throwable ignored) {
            }
            if (code == 401) msg = "DeepSeek API Key 无效";
            if (code == 402) msg = "DeepSeek 余额不足";
            if (code == 429) msg = "请求过于频繁，稍后再试";
            throw new IllegalStateException(msg);
        }
        return body;
    }

    private static String readFully(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (fallbackShown) return;
            try {
                view.evaluateJavascript(ERROR_HOOK_JS, null);
            } catch (Throwable ignored) {
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    WebResourceError error) {
            if (fallbackShown || request == null || !request.isForMainFrame()) return;
            Uri uri = request.getUrl();
            String url = uri == null ? "" : uri.toString();
            if (url.startsWith("file:///android_asset/")) {
                showFallback(new IllegalStateException("页面资源加载失败"));
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            showFallback(new IllegalStateException("WebView 渲染进程已退出"));
            return true;
        }
    }

    private final class AppChromeClient extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                      android.os.Message resultMsg) {
            return false;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message,
                                 final android.webkit.JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message,
                                   final android.webkit.JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message,
                                  String defaultValue, final android.webkit.JsPromptResult result) {
            final EditText input = new EditText(MainActivity.this);
            input.setSingleLine(true);
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setSelection(input.getText().length());

            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton(android.R.string.ok,
                            (dialog, which) -> result.confirm(input.getText().toString()))
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view,
                                         ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(intent, "选择文件"),
                        FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException error) {
                ValueCallback<Uri[]> pending = filePathCallback;
                filePathCallback = null;
                if (pending != null) pending.onReceiveValue(null);
                showToast("手表上没有可用的文件选择器");
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                );
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            try { webView.saveState(outState); } catch (Throwable ignored) {}
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            try { webView.onPause(); } catch (Throwable ignored) {}
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            try { webView.onResume(); } catch (Throwable ignored) {}
        }
        hideSystemUi();
    }

    @Override
    public void onTrimMemory(int level) {
        if (webView != null && level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            try { webView.freeMemory(); } catch (Throwable ignored) {}
        }
        super.onTrimMemory(level);
    }

    @Override
    protected void onDestroy() {
        netExecutor.shutdownNow();
        if (webView != null) {
            try {
                webView.loadUrl("about:blank");
                webView.stopLoading();
                webView.destroy();
            } catch (Throwable ignored) {
            }
            webView = null;
        }
        super.onDestroy();
    }
}
