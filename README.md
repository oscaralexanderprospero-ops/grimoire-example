# grimoire-example

Sanitized source preparation candidate. Application code: AGPL-3.0-only; see LICENSE and LICENSING.md. Unsigned APK packaging and Java compilation verified; device installation remains untested.

Run JavaScript tests with Node.js: `node --test tests/*.test.mjs`. Grimoire starts with `node preview/serve.mjs` on loopback port 4317. Audio Writer browser preview opens app/src/main/assets/index.html; microphone/transcription require Android.

No private data, repository history, APK, signing keys, credentials or model weights are distributed. Integrations are unconfigured; Audio Writer network requests are disabled. config.example.json is a documentation template, not a runtime loader.

Android source compilation was checked with JDK 17 and SDK 35. Direct SDK unsigned APK packaging verified; device installation and Gradle builds remain unverified. Audio Writer requires Vosk Android 0.3.75 and JNA 5.18.1 from their upstream Maven artifacts in app/libs, plus the upstream small-en-us-0.15 model in assets/vosk-model. Preserve all notices when obtaining or redistributing them.

Build unsigned APK: run `python build-example.py <toolchain-directory> <dependency-directory>` from this folder. The toolchain layout is jdk-17.0.20.1/bin and sdk/{build-tools/35.0.0,platforms/android-35}. Audio dependency directory must contain upstream vosk-android-0.3.75.aar, jna-5.18.1.aar and vosk-model-small-en-us-0.15.zip. Grimoire ignores the dependency argument. Build outputs stay in build/. Uses a synthetic vector icon and synthetic Grimoire seed. No signing key is used. Unsigned APKs cannot be installed until signed with your own key.
