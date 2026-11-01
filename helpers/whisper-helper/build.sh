#!/bin/sh
# Builds spacedemo-whisper.exe (64-bit Windows) = whisper.cpp's command-line program (MIT, ggml-org/whisper.cpp v1.9.5,
# commit d1be6fde11ac6e0407606b4e42fe72d34add8037), statically linked with MinGW-w64 (posix threads). Plan 5.v.
# Needs: git, cmake, g++-mingw-w64-x86-64-posix. CPU: AVX2 (any PC from ~2013 on).
# _WIN32_WINNT=0x0601: MinGW's headers lack the Windows 10 thread power-throttling API that whisper.cpp uses when told
# it is building for Windows 8+; with it off the threads simply run without that hint.
set -e
cd "$(dirname "$0")"
[ -d whisper.cpp ] || git clone -q --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp whisper.cpp
test "$(git -C whisper.cpp rev-parse HEAD)" = d1be6fde11ac6e0407606b4e42fe72d34add8037
cmake -S whisper.cpp -B whisper.cpp/build-win -DCMAKE_TOOLCHAIN_FILE="$(pwd)/mingw-x64.cmake" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF \
  -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
  -DCMAKE_C_FLAGS="-D_WIN32_WINNT=0x0601" -DCMAKE_CXX_FLAGS="-D_WIN32_WINNT=0x0601" \
  -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++" > /dev/null
cmake --build whisper.cpp/build-win --config Release -j"$(nproc)" --target whisper-cli > /dev/null
cp whisper.cpp/build-win/bin/whisper-cli.exe spacedemo-whisper.exe
echo "built $(pwd)/spacedemo-whisper.exe"
