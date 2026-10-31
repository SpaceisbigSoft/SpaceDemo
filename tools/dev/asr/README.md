# 5.v speech-to-text trial (development only)

1. `npx tsx tools/dev/voice-bursts.ts <demo.dem> <out> [--asi <mssvoice.asi>]`: one 8 kHz WAV per talk burst + `bursts.json` (who, when).
2. Optional AI clean-up (5.g): `python voicefixer_bursts.py <out> <out_vf> 999` (Python 3.11 venv with `voicefixer`; model files from
   `Sources\AI Models` in `~/.cache/voicefixer/...`, see Reference).
3. `python transcribe.py <ggml model> <bursts dir> <result.json>` (venv with `pywhispercpp`; whisper.cpp ggml models,
   MIT, from huggingface.co/ggerganov/whisper.cpp; the owner downloads them into `Sources\AI Models\whisper\`).
   A word list (map callouts + the demo's player names) is given to the model as its prompt.
