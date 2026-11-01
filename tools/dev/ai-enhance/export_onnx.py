# 5.g3: export VoiceFixer (mode 0, 44.1 kHz) to one compact ONNX file with the mixed sizing of 1.6d / 5.g1.
#   python export_onnx.py <out.onnx> [--fp32 <out_fp32.onnx>]
# Graph: wav [1, 1, N] float32 (44.1 kHz, one segment of at most 30 s) -> wav [1, 1, M] float32 (M ~ N; the caller
# trims the centre to N and splits longer audio into 30 s segments, as VoiceFixer's restore_inmem does).
# Weights in the file: vocoder fp16, every other weight with 2+ dimensions int8 + one scale per output channel
# (DequantizeLinear), 1-D weights fp16 (Cast to float32 at load, so all maths runs in float32).
# Needs Python 3.11 + torch + voicefixer + onnx (see README / Reference).
import argparse, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np, torch, torch.nn.functional as F
import onnx
from onnx import helper, numpy_helper, TensorProto

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from enhance_reference import mixed_sizing  # noqa: E402


def patch_unet():
    """VoiceFixer's UNet pads the spectrogram with numpy maths on the shape, which an export would freeze to one
    length. Same padding, written with shape arithmetic the exporter keeps."""
    from voicefixer.restorer import model_kqq_bn as k
    orig = k.UNetResComplex_100Mb.forward
    src = orig.__code__
    def forward(self, sp):
        x = sp
        t = x.shape[2]
        pad_len = (self.downsample_ratio - t % self.downsample_ratio) % self.downsample_ratio
        x = F.pad(x, pad=(0, 0, 0, pad_len))
        x = x[..., 0: x.shape[-1] - 1]
        (x1_pool, x1) = self.encoder_block1(x)
        (x2_pool, x2) = self.encoder_block2(x1_pool)
        (x3_pool, x3) = self.encoder_block3(x2_pool)
        (x4_pool, x4) = self.encoder_block4(x3_pool)
        (x5_pool, x5) = self.encoder_block5(x4_pool)
        (x6_pool, x6) = self.encoder_block6(x5_pool)
        x_center = self.conv_block7(x6_pool)
        x7 = self.decoder_block1(x_center, x6)
        x8 = self.decoder_block2(x7, x5)
        x9 = self.decoder_block3(x8, x4)
        x10 = self.decoder_block4(x9, x3)
        x11 = self.decoder_block5(x10, x2)
        x12 = self.decoder_block6(x11, x1)
        x = self.after_conv_block1(x12)
        x = self.after_conv2(x)
        x = F.pad(x, pad=(0, 1))
        x = x[:, :, 0:t, :]
        return {'mel': x}
    k.UNetResComplex_100Mb.forward = forward
    return orig


class Full(torch.nn.Module):
    """wav -> enhanced wav, the body of VoiceFixer.restore_inmem for one segment (mode 0)."""
    def __init__(self, m):
        super().__init__(); self.m = m
    def forward(self, wav):
        m = self.m
        sp, _, _ = m.f_helper.wav_to_spectrogram_phase(wav)
        mel = m.mel(sp.permute(0, 1, 3, 2)).permute(0, 1, 3, 2)
        out = m.generator(sp, mel)['mel']
        mel = 10 ** torch.clip(out, max=5)
        return m.vocoder(mel)


def kind_of(name, w, names):
    """How a weight is stored: 'int8' (rows = the PyTorch output channels), 'fp16' or 'fp32' (left as is)."""
    param = names.get(name)
    if param is not None:
        return 'fp16' if param.startswith('vocoder.') or w.ndim < 2 else 'int8'
    # Constants the exporter made from parameters:
    if name.startswith('onnx::GRU_'):      # denoiser GRU, gates reordered: W/R (dirs, 3h, in) -> int8 per row; B -> fp16
        return 'int8' if w.ndim == 3 else 'fp16'
    if name.startswith('onnx::MatMul_'):   # denoiser Linear, weight transposed (in, out) -> int8 per column
        return 'int8T'
    if name.startswith('onnx::Conv'):      # vocoder convs with weight norm folded in -> fp16
        return 'fp16'
    return 'fp32'                          # buffers: mel filter, batch-norm statistics


def quantize_rows(rows):
    scale = (np.abs(rows).max(axis=1) / 127).astype(np.float16).astype(np.float32)  # an all-zero row keeps scale 0
    q = np.clip(np.round(rows / np.where(scale > 0, scale, 1)[:, None]), -127, 127).astype(np.int8)
    return q, scale


def compact(src, dst, names):
    """int8 + fp16 scales for 2-D+ non-vocoder weights, fp16 for vocoder and 1-D weights: the numbers of
    mixed_sizing(). Dequantized/cast to float32 inside the graph, so all maths runs in float32."""
    g = src.graph
    new_inits, new_nodes, stats = [], [], {}
    for init in list(g.initializer):
        w = numpy_helper.to_array(init)
        name = init.name
        k = kind_of(name, w, names) if w.dtype == np.float32 and w.size >= 64 else 'fp32'
        stats[k] = stats.get(k, 0) + w.size
        if k == 'fp32':
            new_inits.append(init); continue
        if k == 'fp16':
            h = numpy_helper.from_array(w.astype(np.float16), name + '_f16')
            new_inits.append(h)
            new_nodes.append(helper.make_node('Cast', [h.name], [name], to=TensorProto.FLOAT))
            continue
        rows = w.T if k == 'int8T' else w.reshape(-1, w.shape[-1]) if name.startswith('onnx::GRU_') else w.reshape(w.shape[0], -1)
        q, scale = quantize_rows(np.ascontiguousarray(rows))
        qi = numpy_helper.from_array(q, name + '_q')
        si = numpy_helper.from_array(scale.astype(np.float16), name + '_s16')
        new_inits += [qi, si]
        new_nodes.append(helper.make_node('Cast', [si.name], [name + '_s'], to=TensorProto.FLOAT))
        deq = name + '_dq'
        new_nodes.append(helper.make_node('DequantizeLinear', [qi.name, name + '_s'], [deq], axis=0))
        if k == 'int8T':
            new_nodes.append(helper.make_node('Transpose', [deq], [name], perm=[1, 0]))
        else:
            shp = numpy_helper.from_array(np.array(w.shape, dtype=np.int64), name + '_shape')
            new_inits.append(shp)
            new_nodes.append(helper.make_node('Reshape', [deq, shp.name], [name]))
    print('stored values:', {k: v for k, v in stats.items()})
    del g.initializer[:]
    g.initializer.extend(new_inits)
    nodes = list(g.node); del g.node[:]
    g.node.extend(new_nodes + nodes)
    onnx.save(src, dst)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--fp32')
    a = ap.parse_args()
    from voicefixer import VoiceFixer
    vf = VoiceFixer(); m = vf._model.eval()
    mixed_sizing(m)
    patch_unet()
    full = Full(m).eval()
    x = torch.zeros(1, 1, 44100 * 3); x[0, 0, ::7] = 0.01
    tmp = a.fp32 or a.out + '.fp32.onnx'
    with torch.no_grad():
        torch.onnx.export(full, (x,), tmp, input_names=['wav'], output_names=['out'], opset_version=17,
                          dynamic_axes={'wav': {2: 'n'}, 'out': {2: 'm'}}, do_constant_folding=True, dynamo=False,
                          training=torch.onnx.TrainingMode.PRESERVE)  # keep batch norm separate (no folding into convs)
    model = onnx.load(tmp)
    # Map initializers to parameter names: by name (the wrapper adds 'm.'), else by value (the exporter may rename).
    pnames = {n for n, _ in m.named_parameters()}
    params = {}
    for n, p in m.named_parameters():
        params.setdefault((tuple(p.shape), float(p.detach().double().sum())), n)
    names = {}
    for init in model.graph.initializer:
        if init.name.startswith('m.') and init.name[2:] in pnames: names[init.name] = init.name[2:]; continue
        w = numpy_helper.to_array(init)
        key = (tuple(w.shape), float(w.astype(np.float64).sum()))
        if key in params: names[init.name] = params[key]
    left = [(i.name, numpy_helper.to_array(i).size) for i in model.graph.initializer if i.name not in names]
    print('initializers', len(model.graph.initializer), 'parameters found', len(names), 'of', len(pnames),
          '| kept float32:', len(left), 'values', sum(s for _, s in left), sorted(left, key=lambda x: -x[1])[:5])
    compact(model, a.out, names)
    import os
    print('size MB', round(os.path.getsize(a.out) / 1e6, 1))


if __name__ == '__main__':
    main()
