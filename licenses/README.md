# Licence texts for THIRD-PARTY-NOTICES.txt (plan 6.4)

Texts that are not in an npm package's own folder. `node tools/notices.mjs` puts them into `THIRD-PARTY-NOTICES.txt`;
`--check` (run by the tests) fails when that file is out of date. Copied unchanged on 2026-11-01 from:

| File | Source |
|---|---|
| opus-COPYING.txt | https://github.com/xiph/opus `COPYING` @ bafd40dc (2026-10-29) |
| onnxruntime-LICENSE.txt, onnxruntime-ThirdPartyNotices.txt | https://github.com/microsoft/onnxruntime tag v1.31.1 (6af1a932) |
| whisper.cpp-LICENSE.txt | https://github.com/ggml-org/whisper.cpp tag v1.9.5 (d1be6fde) `LICENSE` |
| mingw-w64-runtime-COPYING.txt, winpthreads-COPYING.txt | https://github.com/mingw-w64/mingw-w64 @ ee9bd876 (2026-11-01): `COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt`, `mingw-w64-libraries/winpthreads/COPYING` |
| dxc-LICENSE.txt, dxc-ThirdPartyNotices.txt | https://github.com/microsoft/DirectXShaderCompiler @ f9fc72ad (2026-10-30) `LICENSE.TXT`, `ThirdPartyNotices.txt` |
| directml.txt | Written by us: name, version and link to Microsoft's DirectML licence terms (nuget.org, Microsoft.AI.DirectML 1.15.4) |

Speex's licence stays at `helpers/speex/COPYING`. When a shipped part changes version, update its text here.
