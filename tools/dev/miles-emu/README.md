# Miles voice decoder harness (development only)

Old CS demos (1.0–1.5 era) store voice as **`voice_miles`** = Miles Sound System + **Voxware MetaVoice VR12**.
Today's game can't play it (it uses Steam voice). This folder decodes it so `tools/voice-transcode-test.ts` can
put it back into a converted demo as Steam voice.

It runs **your own** `mssvoice.asi` (from your CS 1.6 folder) inside the Unicorn CPU emulator. The plugin is never
run natively, never inside the game, and never committed or shared (it is RAD Game Tools' code).

## Use
```
pip install unicorn pefile          # (capstone and pocketsphinx are optional, for study/checks)
npx tsx tools/convert.ts old.dem old_48.dem --missing missing.txt
npx tsx tools/dump-voice.ts old_48.dem old_48.voice
python3 tools/dev/miles-emu/decode_all.py <...\Half-Life\mssvoice.asi> old_48.voice old_48.pcm
npx tsx tools/voice-transcode-test.ts old_48.dem old_48.pcm old_48_voice.dem
```
`list_providers.py <mssvoice.asi>` lists the codecs the plugin registers.

## How it works
- `mssvoice.asi` exports only `_RIB_Main@20` and imports 8 functions (memory, tick count, cursor position).
  The harness supplies those itself and calls `RIB_Main`, which registers three providers:
  VR12 encoder (PCM → `.V12`), **VR12 decoder** (`.V12` → PCM, wave tag 0x77, max frame 6 bytes) and RT24 decoder.
- Decoding uses the provider's `ASI_stream_open(alloc, free, user, fetch_callback, total_size)` and
  `ASI_stream_process(stream, buffer, bytes)`; the fetch callback (stdcall, 4 arguments) feeds packet bytes.
- Output: 8 kHz, 16-bit, mono. 12 bytes of voice data → 360 samples (45 ms).

See `docs/FORMAT.md` (Old voice: voice_miles) for the measured facts.

## Miles 6 (2000-era) plugins
`miles6_emu.py` loads an old Miles 6 voice plugin (`Mssv12.asi`, as shipped with Half-Life 1.1.1.0 in 2002). These
register themselves from DllMain, so the emulator supplies a small set of Windows functions, a thread block (FS) and
flat segments; `ASI_stream_open` takes 3 arguments (user, fetch callback, total size).

**Result (2026-10-26):** with Windows' default FPU control word (0x027F: exceptions masked, 53-bit precision), the
2000 `Mssv12.asi` and the 2012 `mssvoice.asi` decode modCTside **bit-identically** (3,239,640 samples). The decoder
build is not why old voice sounds rough; that is VR12 itself.

The emulator now sets FPCW 0x027F before running plugin code, to match Windows. (Before, it used Unicorn's default;
the output differed sample by sample but sounded the same: same recogniser word count, same spectral flatness.)
