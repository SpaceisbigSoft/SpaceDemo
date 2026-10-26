# Development only: run a Miles 6 (2000-era) codec plugin, e.g. Mssv12.asi from a 2002 Half-Life install, in the
# emulator. Original code, GPL v3. Plugins are never committed or run natively.
# Finding (2026-10-26): Mssv12.asi (MSS 6.0m, 2000) decodes the Set 1 voice bit-identically to the 2012 mssvoice.asi.
import struct
from miles_emu import Emu, Decoder

class Rib6(Emu):
    """Miles 6 plugins register themselves from DllMain; we supply minimal Windows + Miles functions."""
    def __init__(s, path):
        s._win = True
        super().__init__(path)
        s.providers = {}
        s._setup_fs()
        # run the DLL's startup (C runtime init, then its DllMain registers the providers)
        entry = s.base + s.pe.OPTIONAL_HEADER.AddressOfEntryPoint
        s.call(entry, s.base, 1, 0)

    def import_impl(s, name):
        def ret(v, n): return (lambda *a: v, n)
        def w(p, data): s.uc.mem_write(p, data)
        T = {
            'GetVersion': ret(0x0A280105, 0),
            'GetVersionExA': (lambda p: (w(p + 4, struct.pack('<IIII', 5, 1, 2600, 2)), 1)[1], 1),
            'HeapCreate': ret(0x5000, 3), 'HeapDestroy': ret(1, 1), 'HeapFree': ret(1, 3),
            'HeapAlloc': (lambda h, f, n: s.malloc(n), 3),
            'HeapReAlloc': (lambda h, f, p, n: s._realloc(p, n), 4),
            'VirtualAlloc': (lambda a, n, t, pr: a if a else s.malloc_aligned(n), 4),
            'VirtualFree': ret(1, 3),
            'GetModuleHandleA': (lambda nm: s.base if nm == 0 else 0, 1),
            'GetProcAddress': ret(0, 2), 'LoadLibraryA': ret(0, 1),
            'GetModuleFileNameA': (lambda h, buf, n: (w(buf, b'C:\\hl\\mssv12.asi\0'), 16)[1], 3),
            'GetEnvironmentVariableA': ret(0, 3),
            'GetEnvironmentStrings': (lambda: s.zeros, 0), 'GetEnvironmentStringsW': ret(0, 0),
            'FreeEnvironmentStringsA': ret(1, 1), 'FreeEnvironmentStringsW': ret(1, 1),
            'GetCommandLineA': (lambda: s.cmdline, 0),
            'GetStartupInfoA': (lambda p: (w(p, struct.pack('<I', 68) + b'\0' * 64), 0)[1], 1),
            'GetStdHandle': ret(0x10, 1), 'GetFileType': ret(2, 1), 'SetHandleCount': (lambda n: n, 1),
            'WriteFile': (lambda h, b, n, wr, o: ((wr and s.w32(wr, n)), 1)[1], 5),
            'GetCPInfo': (lambda cp, p: (w(p, struct.pack('<I', 1) + b'?\0' + b'\0' * 12), 1)[1], 2),
            'GetACP': ret(1252, 0), 'GetOEMCP': ret(437, 0),
            'MultiByteToWideChar': ret(0, 6), 'WideCharToMultiByte': ret(0, 8),
            'GetStringTypeA': ret(0, 5), 'GetStringTypeW': ret(0, 4),
            'LCMapStringA': ret(0, 6), 'LCMapStringW': ret(0, 6),
            'GetCurrentProcess': ret(0xffffffff, 0),
            'ExitProcess': (s._die('ExitProcess'), 1), 'TerminateProcess': (s._die('TerminateProcess'), 2),
            'RaiseException': (s._die('RaiseException'), 4), 'RtlUnwind': ret(0, 4),
            '_AIL_mem_alloc_lock@4': (lambda n: s.malloc(n), 1), '_AIL_mem_free_lock@4': ret(0, 1),
            '_RIB_provider_library_handle@0': (lambda: s._new_handle(), 0),
            'RIB_alloc_provider_handle': (lambda m: s._new_handle(), 1),
            'RIB_register_interface': (s._register, 4),
            'RIB_unregister_interface': ret(0, 4),
        }
        if name not in T: raise KeyError('unhandled import ' + name)
        return T[name]

    def _setup_fs(s):
        from unicorn.x86_const import UC_X86_REG_GDTR, UC_X86_REG_FS
        teb = s.teb  # HEAP_BASE page, reserved by Emu
        s.uc.mem_write(teb, struct.pack('<I', 0xffffffff))      # SEH chain end
        s.w32(teb + 0x18, teb)                                   # self pointer
        gdt = s.malloc_aligned(0x1000)
        def entry(base, limit, access, flags):
            v = limit & 0xffff | (base & 0xffffff) << 16 | (access & 0xff) << 40 | ((limit >> 16) & 0xf) << 48 | (flags & 0xf) << 52 | ((base >> 24) & 0xff) << 56
            return struct.pack('<Q', v)
        from unicorn.x86_const import UC_X86_REG_SS, UC_X86_REG_DS, UC_X86_REG_ES
        s.uc.mem_write(gdt + 8 * 2, entry(0, 0xfffff, 0x92, 0xc))   # flat 32-bit data (stack/data)
        s.uc.mem_write(gdt + 8 * 3, entry(teb, 0xfff, 0x92, 0x4))   # FS -> thread block
        s.uc.reg_write(UC_X86_REG_GDTR, (0, gdt, 8 * 8 - 1, 0))
        for r in (UC_X86_REG_SS, UC_X86_REG_DS, UC_X86_REG_ES):
            s.uc.reg_write(r, 2 << 3)
        s.uc.reg_write(UC_X86_REG_FS, 3 << 3)

    def _die(s, what):
        def f(*a): raise RuntimeError(what + ' called by plugin')
        return f
    def _new_handle(s):
        h = 0x2000 + len(s.providers); s.providers[h] = {}; return h
    def _register(s, prov, name, count, entries):
        d = s.providers.setdefault(prov, {}).setdefault(s.cstr(name), {})
        for i in range(count):
            t, n, tok, sub = struct.unpack('<IIII', s.uc.mem_read(entries + 16 * i, 16))
            d[s.cstr(n)] = (t, tok, sub)
        return 0
    def _realloc(s, p, n):
        q = s.malloc(n)
        if p: s.uc.mem_write(q, bytes(s.uc.mem_read(p, min(n, s.allocs.get(p, n)))))
        return q
    def malloc_aligned(s, n):
        s.heap_ptr = (s.heap_ptr + 0xfff) & ~0xfff
        return s.malloc(n)
    @property
    def zeros(s):
        if not hasattr(s, '_z'): s._z = super().malloc(16)
        return s._z
    @property
    def cmdline(s):
        if not hasattr(s, '_c'): s._c = s.newstr('hl.exe')
        return s._c


class Decoder6(Decoder):
    """Miles 6 ASI stream: ASI_stream_open(user, fetch_callback, total_size)."""
    def __init__(s, rib, handle):
        s.r = rib
        p = rib.providers[handle]
        s.codec = {k: v[1] for k, v in p['ASI codec'].items()}
        s.stream = {k: v[1] for k, v in p['ASI stream'].items()}
        s.src = b''; s.pos = 0
        def fetch(_user, dest, n, _offset):
            chunk = s.src[s.pos:s.pos + n]; s.pos += len(chunk)
            if chunk: rib.uc.mem_write(dest, chunk)
            return len(chunk)
        f = rib.stub('fetch', (fetch, 4))
        rib.call(s.codec['ASI_startup'])
        s.h = rib.call(s.stream['ASI_stream_open'], 1, f, 0)
        if not s.h: raise RuntimeError('ASI_stream_open failed')
        s.out = rib.malloc(1 << 16)
