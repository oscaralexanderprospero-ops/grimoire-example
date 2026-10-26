package com.oscarsmagickalauthor.grimoire;



// Offline Grimoire: trusted packaged pages, private on-device storage, explicit document import/export.

// No network permission or remote page loading.



import android.app.Activity;

import android.content.ActivityNotFoundException;

import android.content.ClipData;

import android.content.Intent;

import android.graphics.Color;

import android.net.Uri;

import android.os.Build;

import android.os.Bundle;

import android.view.WindowInsets;

import android.util.Base64;

import android.webkit.CookieManager;

import android.webkit.JavascriptInterface;

import android.webkit.ValueCallback;

import android.webkit.WebChromeClient;

import android.webkit.WebResourceError;

import android.webkit.WebResourceRequest;

import android.webkit.WebSettings;

import android.webkit.WebView;

import android.webkit.WebViewClient;

import android.widget.FrameLayout;

import android.widget.Toast;

import java.io.OutputStream;

import java.util.ArrayList;

import java.util.List;



public class MainActivity extends Activity {

    static final String HOST = "grimoire.invalid";        // reserved packaged-content origin

    static final String SCHEME = "https";    // HTTPS origin for WebView storage

    static final String ORIGIN = SCHEME + "://" + HOST;

    static final String APP_MARK = "LatticeAgeGrimoireApp/0.2";

    static final int PICK_FILE = 1;

    static final int SAVE_FILE = 2;



    WebView web;

    ValueCallback<Uri[]> fileCallback;

    byte[] pendingSave;          // a file the page asked to save, waiting for the "save as" dialog



    // Exports, readable copies and SVGs are made in the page as in-memory (blob:) files, which can't be

    // handed to another app. The page passes them here instead (window.GrimoireApp.saveFile) and the

    // phone's own "save as" dialog decides where they go. The bridge can only WRITE a file the person

    // then places themselves; it can't read anything. Guards: it acts only while the page shown is the

    // grimoire's own origin (other sites never load here: links elsewhere open outside, and the pages'

    // Content-Security-Policy allows only same-origin frames); one save at a time; size and content checked.

    class Bridge {

        @JavascriptInterface public boolean offlineMode() { return true; }

        @JavascriptInterface

        public void saveFile(String name, String mime, String base64) {

            if (base64 == null || base64.length() > Origins.MAX_SAVE_BASE64) {      // checked before any copying

                runOnUiThread(() -> say("That file is too large to save from the phone. Make large exports on the laptop."));

                return;

            }

            runOnUiThread(() -> startSave(name, mime, base64));

        }

    }



    void say(String text) {

        Toast.makeText(this, text, Toast.LENGTH_LONG).show();

    }



    void startSave(String name, String mime, String base64) {

        String shown = web.getUrl();

        if (shown == null || !Origins.sameOrigin(shown, ORIGIN)) return;          // not the grimoire's own page: ignore

        if (pendingSave != null) { say("Finish the save that is already open first."); return; }

        byte[] bytes;

        try {

            bytes = Base64.decode(base64, Base64.DEFAULT);

        } catch (IllegalArgumentException e) {

            say("The file could not be prepared for saving.");

            return;

        } catch (OutOfMemoryError e) {

            say("That file is too large to save from the phone. Make large exports on the laptop.");

            return;

        }

        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);

        i.addCategory(Intent.CATEGORY_OPENABLE);

        i.setType(Origins.safeMime(mime));

        i.putExtra(Intent.EXTRA_TITLE, Origins.safeName(name));

        try {

            pendingSave = bytes;

            startActivityForResult(i, SAVE_FILE);

        } catch (ActivityNotFoundException e) {

            pendingSave = null;

            say("This phone has no way to save files here.");

        }

    }



    // The page's file boxes: photos (several JPEG/PNG/WebP/GIF types, sometimes several at once) and

    // grimoire files for import (".json"). FileChooserParams.createIntent() only uses the first type and

    // one file, so the picker is built here: mime types become EXTRA_MIME_TYPES; any extension-only

    // accept value (".json") opens the picker unfiltered, because phones label JSON inconsistently.

    Intent pickIntent(WebChromeClient.FileChooserParams params) {

        Intent i = new Intent(Intent.ACTION_GET_CONTENT);

        i.addCategory(Intent.CATEGORY_OPENABLE);

        List<String> mimes = new ArrayList<>();

        boolean extensionOnly = false;

        for (String t : params.getAcceptTypes()) {

            if (t == null) continue;

            for (String p : t.split(",")) {

                p = p.trim();

                if (p.isEmpty()) continue;

                if (p.startsWith(".")) extensionOnly = true; else mimes.add(p);

            }

        }

        if (extensionOnly || mimes.isEmpty()) i.setType("*/*");

        else if (mimes.size() == 1) i.setType(mimes.get(0));

        else { i.setType("*/*"); i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0])); }

        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        return i;

    }



    @Override

    protected void onCreate(Bundle saved) {

        super.onCreate(saved);

        FrameLayout root = new FrameLayout(this);

        root.setBackgroundColor(Color.parseColor("#f7f3ea"));

        web = new WebView(this);

        root.addView(web);

        setContentView(root);



        // Keep the page clear of the status bar, navigation bar and keyboard.

        if (Build.VERSION.SDK_INT >= 30) {

            root.setOnApplyWindowInsetsListener((v, insets) -> {

                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());

                v.setPadding(i.left, i.top, i.right, i.bottom);

                return WindowInsets.CONSUMED;

            });

        }



        WebSettings s = web.getSettings();

        s.setJavaScriptEnabled(true);

        s.setDomStorageEnabled(true);

        s.setAllowContentAccess(false);

        s.setBlockNetworkLoads(true);

        s.setAllowFileAccess(false);                 // the app never needs the phone's files as web pages

        s.setUserAgentString(s.getUserAgentString() + " " + APP_MARK);

        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "GrimoireApp");



        web.setWebViewClient(new WebViewClient() {

            @Override

            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {

                String path = req.getUrl().getPath();

                try {

                    if (!Origins.sameOrigin(req.getUrl().toString(), ORIGIN) || !"GET".equals(req.getMethod())) throw new java.io.IOException();

                    if (path.equals("/")) path = "/index.html";

                    if (!path.matches("/[a-zA-Z0-9_./-]+") || path.contains("..")) throw new java.io.IOException();

                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/json";

                    java.util.Map<String,String> headers = new java.util.HashMap<>();

                    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");

                    headers.put("X-Content-Type-Options", "nosniff");

                    return new android.webkit.WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("web" + path));

                } catch (java.io.IOException e) {

                    return new android.webkit.WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new java.io.ByteArrayInputStream(new byte[0]));

                }

            }



            @Override

            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {

                Uri u = req.getUrl();

                if ("grimoireaction".equals(u.getScheme())) { web.loadUrl(ORIGIN + "/"); return true; }

                // Same scheme, host AND port as the grimoire (HOST may include ":4317"); anything else,

                // including redirects elsewhere, opens outside the app, so other sites never see the bridge.

                if (Origins.sameOrigin(u.toString(), ORIGIN)) return false;

                openOutside(u.toString());           // links elsewhere open in the phone's browser

                return true;

            }



            @Override

            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {

                if (req.isForMainFrame()) showOfflinePage();

            }



            @Override

            public void onPageFinished(WebView view, String url) {

                CookieManager.getInstance().flush();

            }

        });



        // File boxes (photos for entries and journal observations) open the phone's picker.

        web.setWebChromeClient(new WebChromeClient() {

            @Override

            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {

                if (fileCallback != null) fileCallback.onReceiveValue(null);

                fileCallback = cb;

                try {

                    startActivityForResult(pickIntent(params), PICK_FILE);

                } catch (ActivityNotFoundException e) {

                    fileCallback = null;

                    return false;

                }

                return true;

            }

        });



        // Ordinary http downloads (none in the grimoire today) go to the phone's browser; the grimoire's own

        // exports use the save bridge above.

        web.setDownloadListener((url, ua, cd, mime, len) -> { if (!url.startsWith("blob:")) openOutside(url); });



        if (!handleLink(getIntent())) web.loadUrl(ORIGIN + "/");

    }



    @Override

    protected void onNewIntent(Intent intent) {

        super.onNewIntent(intent);

        handleLink(intent);

    }



    // grimoire://pair?c=<one-time code>

    boolean handleLink(Intent intent) { return false; }



    void openOutside(String url) {

        try {

            Uri target = Uri.parse(url);

            if (!"https".equals(target.getScheme()) && !"http".equals(target.getScheme())) return;

            startActivity(new Intent(Intent.ACTION_VIEW, target));

        } catch (ActivityNotFoundException e) {

            // nothing on the phone can open it

        }

    }



    void showOfflinePage() {

        String html = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"

            + "<body style='margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:24px;"

            + "box-sizing:border-box;background:#f7f3ea;color:#2a2620;font:19px/1.5 Georgia,serif'>"

            + "<h1 style='font-size:28px;margin:0 0 12px'>Can't reach the grimoire</h1>"

            + "<p>The packaged page could not be opened. Your saved entries remain on this phone. Close and reopen the app; do not clear app data.</p>"

            + "<a href='grimoireaction://retry' style='display:block;margin-top:20px;padding:16px;border-radius:12px;background:#8a5a2b;"

            + "color:#f7f3ea;text-align:center;text-decoration:none;font:600 20px system-ui'>Try again</a></body>";

        web.loadDataWithBaseURL(ORIGIN + "/", html, "text/html", "utf-8", null);

    }



    @Override

    protected void onActivityResult(int request, int result, Intent data) {

        if (request == PICK_FILE && fileCallback != null) {

            Uri[] picked = null;

            if (result == RESULT_OK && data != null) {

                ClipData clip = data.getClipData();            // several files

                if (clip != null && clip.getItemCount() > 0) {

                    picked = new Uri[clip.getItemCount()];

                    for (int k = 0; k < picked.length; k++) picked[k] = clip.getItemAt(k).getUri();

                } else if (data.getData() != null) {

                    picked = new Uri[]{data.getData()};

                }

            }

            fileCallback.onReceiveValue(picked);

            fileCallback = null;

            return;

        }

        if (request == SAVE_FILE) {

            byte[] bytes = pendingSave;

            pendingSave = null;

            if (result != RESULT_OK || data == null || data.getData() == null) return;   // cancelled: nothing written

            if (bytes == null) { say("The file was lost while choosing where to save it (the phone closed the app). Export again."); return; }

            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {

                if (out == null) throw new java.io.IOException("no place to write");

                out.write(bytes);

                Toast.makeText(this, "Saved.", Toast.LENGTH_SHORT).show();

            } catch (Exception e) {

                say("Could not save the file: " + e.getMessage());

            }

            return;

        }

        super.onActivityResult(request, result, data);

    }



    @Override

    public void onBackPressed() {

        if (web.canGoBack()) web.goBack();

        else super.onBackPressed();

    }



    @Override

    protected void onPause() {

        super.onPause();

        CookieManager.getInstance().flush();

    }

}

