# Batch decoder for the engine (plan 2.8, development/test decoder): same protocol as the Windows helper.
#   python3 tools/dev/miles-emu/decode_batch.py <path to your mssvoice.asi>  < request > response
# Request (stdin):  u32 count, then per packet: u32 stream, u32 length, bytes   (stream = one decoder per player)
# Response (stdout): per packet: u32 byte length, 8 kHz 16-bit mono PCM          (empty packet -> length 0)
import struct, sys
from miles_emu import Rib, Decoder

rib = Rib(sys.argv[1])
vr12 = rib.find_decoder('.V12 files')  # GoldSrc voice_miles = Voxware MetaVoice VR12
data = sys.stdin.buffer.read()
count, = struct.unpack_from('<I', data, 0)
p = 4
decoders = {}
out = sys.stdout.buffer
for _ in range(count):
    stream, n = struct.unpack_from('<II', data, p)
    pkt = data[p + 8:p + 8 + n]
    p += 8 + n
    pcm = b''
    if pkt:
        if stream not in decoders:
            decoders[stream] = Decoder(rib, vr12)
        pcm = decoders[stream].decode(pkt)
    out.write(struct.pack('<I', len(pcm)) + pcm)
out.flush()
