#!/bin/sh
# Builds cdf-voice-helper.exe (32-bit Windows) with MinGW-w64. The plugin it loads is 32-bit, so the helper must be too.
# --no-insert-timestamp: the same source gives the same file (CI builds can be checked byte for byte).
set -e
cd "$(dirname "$0")"
i686-w64-mingw32-gcc -O1 -fno-omit-frame-pointer -Wall -Wextra -Wno-cast-function-type -static -Wl,--no-insert-timestamp -o cdf-voice-helper.exe voice_helper.c
echo "built $(pwd)/cdf-voice-helper.exe"
