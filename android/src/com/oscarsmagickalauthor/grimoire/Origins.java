package com.oscarsmagickalauthor.grimoire;

// Plain Java (no Android classes), so the rules can be unit-tested on the laptop's JDK.
import java.net.URI;
import java.util.Locale;

final class Origins {
    private Origins() {}

    /** True only for a URL on exactly the configured origin: same scheme, host and port (default ports filled in). */
    static boolean sameOrigin(String url, String origin) {
        try {
            URI u = new URI(url), o = new URI(origin);
            if (u.getScheme() == null || o.getScheme() == null || u.getHost() == null || o.getHost() == null) return false;
            if (u.getRawUserInfo() != null) return false;                       // http://grimoire@evil.example tricks
            String us = u.getScheme().toLowerCase(Locale.ROOT), os = o.getScheme().toLowerCase(Locale.ROOT);
            if (!us.equals(os) || !(us.equals("http") || us.equals("https"))) return false;
            if (!u.getHost().equalsIgnoreCase(o.getHost())) return false;
            return port(u) == port(o);
        } catch (Exception e) {
            return false;
        }
    }

    private static int port(URI u) {
        if (u.getPort() != -1) return u.getPort();
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    // Limits for files the page asks the app to save (exports, readable copies, SVGs).
    static final int MAX_SAVE_BASE64 = 64 * 1024 * 1024;   // ≈ 48 MB file; larger exports belong on the laptop

    /** A safe file name for the Save as dialog: plain characters only, never empty, at most 100 characters. */
    static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._ -]", "_").trim();
        if (n.isEmpty() || n.replace(".", "").isEmpty()) n = "grimoire-file";
        return n.length() > 100 ? n.substring(0, 100) : n;
    }

    /** A plain type/subtype mime, or the generic binary type. */
    static String safeMime(String mime) {
        return mime != null && mime.matches("[a-z]+/[a-z0-9.+-]{1,80}") ? mime : "application/octet-stream";
    }
}
