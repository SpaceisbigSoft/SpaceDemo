# 5.g AI voice enhancement — reference (development only)

The reference the app's compact version (5.g3/5.g4) must sound like. Rebuilt in 5.g1 (2026-11-01) from the Spike 3
description, because the 1.6d trial code (`16ade37`) is not in this repository's history.

1. `npx tsx tools/dev/ai-enhance/voice-tracks.ts <demo.dem> <out> --asi <mssvoice.asi> [--from s] [--to s]`
   One 8 kHz track per player on the voice timeline + the talk bursts (`tracks.json`), the mix (`mix.wav`) and every
   decoded packet (`packets.json` + `packets.pcm`). Time zero = the first voice packet; per player each packet starts
   at floor((time − zero) × 8000) or right after that player's previous packet, whichever is later. With
   `modCTside.dem --to 60` the mix is **sample-identical** to trial sample 6 (`6_MoD_60s_original.wav`).
2. `python tools/dev/ai-enhance/enhance_reference.py <out> <result.wav> [--size full|mixed] [--smooth] [--cache dir]`
   (Python 3.11 venv with `torch` + `voicefixer`; model files in `~/.cache/voicefixer`, see Reference → Settings).
   Per player: bursts joined with 0.2 s silences → VoiceFixer mode 0 → cut back to the timeline → loudness matched per
   burst (RMS) → smooth endings → mixed. `--size mixed` rounds the weights to the 151 MB file: vocoder fp16; every other
   weight with 2+ dimensions (incl. the STFT layers) int8 with one fp16 scale per output channel (an all-zero row keeps
   scale 0); 1-D weights fp16 → 150.9 MB.

Smooth endings: gain from the original voice's envelope (attack 5 ms, release 40 ms) against the burst's peak:
1 above peak − 24 dB, (envelope ÷ knee)^1.5 below, 0 under peak − 45 dB, then a 20 ms fade-out (knee and power fitted to
trial samples 12 → 14).

Not sample-identical to the trial: VoiceFixer's vocoder output depends on exactly where each burst falls in its input,
and the trial's join positions are lost. Spectrally the rebuild matches: mixed + smooth vs trial sample 15 is within
±0.5 dB in every band (0–22 kHz) and log-mel correlation 0.984 (trial 8 vs 15: 0.986).
