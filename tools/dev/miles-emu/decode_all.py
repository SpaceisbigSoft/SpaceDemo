# Decode every voice packet of a voice dump (in demo order) to 8 kHz PCM, one decoder per player slot.
#   python3 tools/dev/miles-emu/decode_all.py <path to your mssvoice.asi> <voice dump> <output .pcm>
# Output: for each packet, [u32 byte length][PCM]; empty packets give length 0.
import struct, sys, time
from miles_emu import Rib, Decoder, read_voice_dump

asi, src, dst = sys.argv[1:4]
packets = read_voice_dump(src)
rib = Rib(asi)
vr12 = rib.find_decoder('.V12 files')  # GoldSrc voice_miles = Voxware MetaVoice VR12
decoders = {}
started = time.time()
out = []
for slot, _, data in packets:
    pcm = b''
    if data:
        if slot not in decoders:
            decoders[slot] = Decoder(rib, vr12)
        pcm = decoders[slot].decode(data)
    out.append(struct.pack('<I', len(pcm)) + pcm)
open(dst, 'wb').write(b''.join(out))
print(f'{len(packets)} packets decoded in {time.time() - started:.1f} s')
