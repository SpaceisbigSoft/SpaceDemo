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
