# Development-only harness (plan task 1.6): runs the owner's own Miles voice plugin (mssvoice.asi, from the CS 1.6
# install) inside a CPU emulator (Unicorn), to decode old Miles/Voxware voice from demos.
# Original code (GPL v3). Nothing here touches the game, and the plugin is never run natively.
# The plugin file is never committed or redistributed: pass the path to your own copy.
import struct, pefile
from unicorn import *
from unicorn.x86_const import *

STUB_BASE = 0x20000000
HEAP_BASE = 0x30000000
HEAP_SIZE = 0x04000000
STACK_BASE = 0x7f000000
STACK_SIZE = 0x00200000
SENTINEL = STUB_BASE + 0xFFF0


class Emu:
    def __init__(self, path, trace=False):
        self.pe = pe = pefile.PE(path)
        self.base = pe.OPTIONAL_HEADER.ImageBase
        size = (pe.OPTIONAL_HEADER.SizeOfImage + 0xFFF) & ~0xFFF
        self.uc = uc = Uc(UC_ARCH_X86, UC_MODE_32)
        uc.mem_map(self.base, size)
        uc.mem_write(self.base, pe.header[:pe.OPTIONAL_HEADER.SizeOfHeaders])
        for s in pe.sections:
            uc.mem_write(self.base + s.VirtualAddress, s.get_data())
        uc.mem_map(STUB_BASE, 0x10000)
        uc.mem_write(STUB_BASE, b'\xc3' * 0x10000)
        uc.mem_map(HEAP_BASE, HEAP_SIZE)
        uc.mem_map(STACK_BASE, STACK_SIZE)
        # FS segment for anything touching the TEB
        self.teb = HEAP_BASE
        self.heap_ptr = HEAP_BASE + 0x2000
        self.stubs = {}  # addr -> (name, nargs, fn)
        self.next_stub = STUB_BASE
        self.allocs = {}
        self.imports = {}
        for imp in pe.DIRECTORY_ENTRY_IMPORT:
            for i in imp.imports:
                name = i.name.decode() if i.name else f'ord{i.ordinal}'
                addr = self.stub(name, self.import_impl(name))
                uc.mem_write(i.address, struct.pack('<I', addr))
        uc.hook_add(UC_HOOK_CODE, self._on_stub, begin=STUB_BASE, end=STUB_BASE + 0xFFFF)
        uc.hook_add(UC_HOOK_MEM_INVALID, self._on_bad)

    # ---- memory helpers
    def malloc(self, n):
        n = (n + 15) & ~15
        p = self.heap_ptr
        self.heap_ptr += n
        assert self.heap_ptr < HEAP_BASE + HEAP_SIZE, 'emulator heap exhausted'
        self.uc.mem_write(p, b'\0' * n)
        self.allocs[p] = n
        return p

    def u32(self, a): return struct.unpack('<I', self.uc.mem_read(a, 4))[0]
    def w32(self, a, v): self.uc.mem_write(a, struct.pack('<I', v & 0xffffffff))
    def cstr(self, a):
        out = b''
        while True:
            c = bytes(self.uc.mem_read(a, 1))
            if c == b'\0': return out.decode('latin1')
            out += c; a += 1
    def newstr(self, s):
        b = s.encode() + b'\0'
        p = self.malloc(len(b)); self.uc.mem_write(p, b); return p

    # ---- stubs (stdcall: callee pops nargs)
    def stub(self, name, impl):
        fn, nargs = impl
        addr = self.next_stub
        self.next_stub += 16
        self.stubs[addr] = (name, nargs, fn)
        return addr

    def import_impl(self, name):
        def ret(v): return lambda *a: v
        table = {
            'GetCursorPos': (lambda p: (self.w32(p, 0), self.w32(p + 4, 0), 1)[-1], 1),
            'GetTickCount': (ret(123456), 0),
            'GlobalAlloc': (lambda flags, n: self.malloc(n), 2),
            'GlobalFree': (ret(0), 1),
            'DisableThreadLibraryCalls': (ret(1), 1),
            '_AIL_mem_alloc_lock_info@12': (lambda n, f, l: self.malloc(n), 3),
            '_AIL_mem_free_lock@4': (ret(0), 1),
            '_RIB_alloc_provider_handle@4': (ret(0x777), 1),
        }
        if name not in table: raise KeyError('unhandled import ' + name)
        return table[name]

    def _on_stub(self, uc, addr, size, _):
        if addr == SENTINEL:
            uc.emu_stop(); return
        if addr not in self.stubs: raise RuntimeError(f'jump into stub area {addr:#x}')
        name, nargs, fn = self.stubs[addr]
        esp = uc.reg_read(UC_X86_REG_ESP)
        retaddr = self.u32(esp)
        args = [self.u32(esp + 4 + 4 * i) for i in range(nargs)]
        r = fn(*args)
        uc.reg_write(UC_X86_REG_EAX, (r or 0) & 0xffffffff)
        uc.reg_write(UC_X86_REG_ESP, esp + 4 + 4 * nargs)
        uc.reg_write(UC_X86_REG_EIP, retaddr)

    def _on_bad(self, uc, access, addr, size, value, _):
        eip = uc.reg_read(UC_X86_REG_EIP)
        print(f'!! invalid memory access {access} at {addr:#x} (eip {eip:#x})')
        return False

    # ---- calling into the DLL (stdcall or cdecl both fine: we restore esp)
    def call(self, fn, *args):
        uc = self.uc
        sp = STACK_BASE + STACK_SIZE - 0x1000
        for a in reversed(args):
            sp -= 4; self.w32(sp, a)
        sp -= 4; self.w32(sp, SENTINEL)
        uc.reg_write(UC_X86_REG_ESP, sp)
        uc.reg_write(UC_X86_REG_EBP, 0)
        uc.emu_start(fn, SENTINEL)
        return uc.reg_read(UC_X86_REG_EAX)

    def export(self, name):
        for e in self.pe.DIRECTORY_ENTRY_EXPORT.symbols:
            if e.name and e.name.decode() == name: return self.base + e.address
        raise KeyError(name)


class Rib(Emu):
    """Loads a Miles RIB provider (an .asi plugin) and records the interfaces it registers, per provider handle."""

    MAIN_HANDLE = 0x777

    def __init__(s, path):
        super().__init__(path)
        s.providers = {s.MAIN_HANDLE: {}}  # handle -> {interface name: {entry name: (type, token, subtype)}}

        def alloc(_module):
            h = 0x1000 + len(s.providers)
            s.providers[h] = {}
            return h

        def register(prov, name, count, entries):
            d = s.providers[prov].setdefault(s.cstr(name), {})
            for i in range(count):
                t, n, tok, sub = struct.unpack('<IIII', s.uc.mem_read(entries + 16 * i, 16))
                d[s.cstr(n)] = (t, tok, sub)
            return 0

        f_alloc = s.stub('alloc', (alloc, 1))
        f_reg = s.stub('register', (register, 4))
        f_unreg = s.stub('unregister', (lambda *a: 0, 4))
        # DllMain only sets up the compiler's security cookie (it reads the TEB); set a cookie ourselves instead.
        s.w32(0x10027000, 0xBB40E64E)
        s.call(s.export('_RIB_Main@20'), s.MAIN_HANDLE, 1, f_alloc, f_reg, f_unreg)

    def provider_property(s, handle, name):
        """PROVIDER_property(index, before_value*, new_value*, after_value*) of the provider's 'ASI codec' interface."""
        codec = s.providers[handle]['ASI codec']
        _, token, subtype = codec[name]
        buf = s.malloc(16)
        s.call(codec['PROVIDER_property'][1], token, buf, 0, 0)
        v = s.u32(buf)
        return s.cstr(v) if subtype == 0x80000007 else v

    def find_decoder(s, input_type):
        """Handle of the provider whose input file type is e.g. '.V12 files' and output is raw PCM."""
        for h in s.providers:
            if 'ASI codec' in s.providers[h] and s.provider_property(h, 'Input file types') == input_type:
                return h
        raise KeyError(input_type)


class Decoder:
    """One ASI decoding stream (keep one per player: the codec carries state from frame to frame).
    Output: 8 kHz, 16-bit, mono PCM."""

    def __init__(s, rib, handle):
        s.r = rib
        p = rib.providers[handle]
        s.codec = {k: v[1] for k, v in p['ASI codec'].items()}
        s.stream = {k: v[1] for k, v in p['ASI stream'].items()}
        s.src = b''
        s.pos = 0

        def fetch(_user, dest, n, _offset):  # AILASIFETCHCB, stdcall
            chunk = s.src[s.pos:s.pos + n]
            s.pos += len(chunk)
            if chunk:
                rib.uc.mem_write(dest, chunk)
            return len(chunk)

        f_fetch = rib.stub('fetch', (fetch, 4))
        rib.call(s.codec['ASI_startup'])
        # ASI_stream_open(alloc, free, user, fetch_callback, total_size)
        s.h = rib.call(s.stream['ASI_stream_open'], 0, 0, 1, f_fetch, 0)
        if not s.h:
            raise RuntimeError('ASI_stream_open failed')
        s.out = rib.malloc(1 << 16)

    def decode(s, data):
        s.src = bytes(data)
        s.pos = 0
        pcm = b''
        while True:
            n = s.r.call(s.stream['ASI_stream_process'], s.h, s.out, 4096)
            if n <= 0:
                break
            pcm += bytes(s.r.uc.mem_read(s.out, n))
            if s.pos >= len(s.src) and n < 4096:
                break
        return pcm


def read_voice_dump(path):
    """Reads tools/dump-voice.ts output: [slot u8][time f64][length u16][bytes] per svc_voicedata message."""
    b = open(path, 'rb').read()
    p = 0
    out = []
    while p < len(b):
        slot = b[p]
        t, = struct.unpack_from('<d', b, p + 1)
        n, = struct.unpack_from('<H', b, p + 9)
        out.append((slot, t, b[p + 11:p + 11 + n]))
        p += 11 + n
    return out
