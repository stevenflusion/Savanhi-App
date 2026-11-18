#!/usr/bin/env python3
"""Patch a freshly prebuilt Expo android/app/build.gradle for CI release builds.

Usage: android-release-config.py <path/to/build.gradle> <version-code>

- Adds a `release` signing config that reads the keystore from the environment
  (ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
  ANDROID_KEY_PASSWORD) and points the release build type at it, replacing the
  debug keystore Expo generates by default.
- Sets versionCode so every build can be installed over the previous one.

It fails loudly when the generated file does not have the expected shape, so a
template change in Expo never silently ships a debug-signed APK.
"""
import re
import sys

RELEASE_SIGNING = """signingConfigs {
        release {
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
"""


def fail(message: str) -> None:
    sys.exit(f"android-release-config: {message}")


def main() -> None:
    if len(sys.argv) != 3 or not sys.argv[2].isdigit():
        fail("usage: android-release-config.py <build.gradle> <version-code>")
    path, version_code = sys.argv[1], sys.argv[2]
    text = open(path, encoding="utf-8").read()

    text, count = re.subn(r"signingConfigs\s*\{\n", RELEASE_SIGNING, text, count=1)
    if count != 1:
        fail("signingConfigs block not found")

    # Only the `release` build type: the debug one must keep the debug keystore.
    text, count = re.subn(
        r"(buildTypes\s*\{.*?\brelease\s*\{.*?)signingConfig signingConfigs\.debug",
        r"\1signingConfig signingConfigs.release",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        fail("release build type signingConfig not found")

    text, count = re.subn(r"versionCode\s+\d+", f"versionCode {version_code}", text, count=1)
    if count != 1:
        fail("versionCode not found")

    open(path, "w", encoding="utf-8").write(text)
    print(f"patched {path}: release signing + versionCode {version_code}")


main()
