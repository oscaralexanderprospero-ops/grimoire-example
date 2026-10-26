package com.oscarsmagickalauthor.grimoire;

// Runs on a desktop JDK (no Android needed): the phone app's navigation and save-name rules.
public class OriginsCheck {
    static int failures = 0;
    static void check(boolean ok, String what) { if (!ok) { failures++; System.out.println("FAIL: " + what); } }

    public static void main(String[] args) {
        String o = "http://example.invalid";
        String op = "http://example.invalid:4317";
        // the grimoire's own pages stay in the app
        check(Origins.sameOrigin("http://example.invalid/", o), "own root");
        check(Origins.sameOrigin("http://example.invalid/pair?c=AB", o), "host case-insensitive");
        check(Origins.sameOrigin("http://example.invalid:80/", o), "explicit default port");
        check(Origins.sameOrigin("http://example.invalid:4317/", op), "configured port (redirect after pairing)");
        // everything else opens outside / is refused by the save bridge
        check(!Origins.sameOrigin("http://example.invalid/", op), "missing port is a different origin");
        check(!Origins.sameOrigin("http://example.invalid:9999/", op), "other port");
        check(!Origins.sameOrigin("https://example.invalid/", o), "other scheme");
        check(!Origins.sameOrigin("http://example.invalid.evil.example/", o), "suffix trick");
        check(!Origins.sameOrigin("http://evil.example/example.invalid", o), "host in path");
        check(!Origins.sameOrigin("http://example.invalid@evil.example/", o), "userinfo trick (host is evil)");
        check(!Origins.sameOrigin("http://x@example.invalid/", o), "userinfo on own host refused");
        check(!Origins.sameOrigin("javascript:alert(1)", o), "javascript:");
        check(!Origins.sameOrigin("data:text/html,hi", o), "data:");
        check(!Origins.sameOrigin("file:///sdcard/x.html", o), "file:");
        check(!Origins.sameOrigin("intent://example.invalid/#Intent;end", o), "intent:");
        check(!Origins.sameOrigin("blob:http://example.invalid/uuid", o), "blob: is not a page origin");
        check(!Origins.sameOrigin("not a url at all", o), "garbage");
        check(!Origins.sameOrigin(null == null ? "" : "", o), "empty");
        // save names and types
        check(Origins.safeName("grimoire-export-2026-10-22-0420.json").equals("grimoire-export-2026-10-22-0420.json"), "normal name kept");
        check(Origins.safeName("../../evil/..\\x.json").equals(".._.._evil_.._x.json"), "path characters neutralised: " + Origins.safeName("../../evil/..\\x.json"));
        check(Origins.safeName(null).equals("grimoire-file"), "null name");
        check(Origins.safeName("...").equals("grimoire-file"), "dots-only name");
        check(Origins.safeName("a".repeat(300)).length() == 100, "long name trimmed");
        check(Origins.safeMime("application/json").equals("application/json"), "json mime");
        check(Origins.safeMime("image/svg+xml").equals("image/svg+xml"), "svg mime");
        check(Origins.safeMime("text/html; charset=x").equals("application/octet-stream"), "odd mime");
        check(Origins.safeMime(null).equals("application/octet-stream"), "null mime");
        System.out.println(failures == 0 ? "ORIGINS OK" : failures + " failure(s)");
        System.exit(failures == 0 ? 0 : 1);
    }
}
