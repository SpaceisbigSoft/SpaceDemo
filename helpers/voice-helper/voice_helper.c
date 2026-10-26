/*
 * CS Demo Fixer voice helper (plan 2.8). Original code, GPL v3.
 *
 * Decodes old Counter-Strike voice (Miles Sound System "voice_miles" = Voxware MetaVoice VR12) to 8 kHz PCM using the
 * user's OWN copy of mssvoice.asi from their Half-Life folder. This program runs on its own: it never touches the
 * game, and no Valve or RAD Game Tools file is shipped with it. It loads the plugin into its own memory (a tiny PE
 * loader) and supplies the 7 functions the plugin imports itself, so no other game file is loaded.
 *
 * Usage: cdf-voice-helper.exe <path to mssvoice.asi>   (request on stdin, response on stdout)
 *   request:  u32 count, then per packet u32 stream, u32 length, bytes (one decoder per stream = per player)
 *   response: per packet u32 byte length, then PCM (empty packet -> length 0)
 * Exit codes: 0 ok, 2 bad arguments, 3 plugin could not be loaded, 4 no VR12 decoder in the plugin, 5 bad request.
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <io.h>
#include <fcntl.h>

typedef unsigned int u32;

/* ---------- functions the plugin imports from mss32.dll (supplied by us) ---------- */
static void *__stdcall my_mem_alloc_lock_info(u32 size, const char *file, u32 line) { (void)file; (void)line; return calloc(1, size ? size : 1); }
static void __stdcall my_mem_free_lock(void *p) { free(p); }
#define MAIN_HANDLE 0x777
static u32 __stdcall my_rib_alloc_provider_handle(u32 module) { (void)module; return MAIN_HANDLE; }
static BOOL __stdcall my_disable_thread_library_calls(HMODULE m) { (void)m; return TRUE; }

/* ---------- registered providers ---------- */
typedef struct { u32 type; const char *name; u32 token; u32 subtype; } RIB_ENTRY;
#define MAX_PROV 16
#define MAX_IF 8
#define MAX_ENT 64
typedef struct { char name[64]; int count; char ent_name[MAX_ENT][64]; u32 token[MAX_ENT]; u32 subtype[MAX_ENT]; } Interface;
typedef struct { u32 handle; int nif; Interface ifs[MAX_IF]; } Provider;
static Provider providers[MAX_PROV];
static int nprov = 0;

static Provider *provider(u32 h) {
  for (int i = 0; i < nprov; i++) if (providers[i].handle == h) return &providers[i];
  if (nprov == MAX_PROV) return NULL;
  memset(&providers[nprov], 0, sizeof(Provider));
  providers[nprov].handle = h;
  return &providers[nprov++];
}
static u32 __stdcall cb_alloc(u32 module) { (void)module; static u32 next = 0x1000; next++; provider(next); return next; }
static u32 __stdcall cb_register(u32 prov, const char *name, int count, const RIB_ENTRY *entries) {
  Provider *p = provider(prov);
  if (!p || p->nif == MAX_IF) return 0;
  Interface *f = &p->ifs[p->nif++];
  strncpy(f->name, name, 63);
  for (int i = 0; i < count && i < MAX_ENT; i++) {
    strncpy(f->ent_name[i], entries[i].name, 63);
    f->token[i] = entries[i].token;
    f->subtype[i] = entries[i].subtype;
    f->count = i + 1;
  }
  return 0;
}
static u32 __stdcall cb_unregister(u32 a, const char *b, int c, const void *d) { (void)a; (void)b; (void)c; (void)d; return 0; }

static Interface *iface(Provider *p, const char *name) {
  for (int i = 0; i < p->nif; i++) if (!strcmp(p->ifs[i].name, name)) return &p->ifs[i];
  return NULL;
}
static int entry(Interface *f, const char *name, u32 *token, u32 *subtype) {
  for (int i = 0; i < f->count; i++) if (!strcmp(f->ent_name[i], name)) { *token = f->token[i]; if (subtype) *subtype = f->subtype[i]; return 1; }
  return 0;
}

/* ---------- a tiny PE loader (32-bit DLL) ---------- */
static void *resolve(const char *dll, const char *fn) {
  if (!_stricmp(dll, "mss32.dll")) {
    if (!strcmp(fn, "_AIL_mem_alloc_lock_info@12")) return (void *)my_mem_alloc_lock_info;
    if (!strcmp(fn, "_AIL_mem_free_lock@4")) return (void *)my_mem_free_lock;
    if (!strcmp(fn, "_RIB_alloc_provider_handle@4")) return (void *)my_rib_alloc_provider_handle;
    return NULL;
  }
  if (!strcmp(fn, "DisableThreadLibraryCalls")) return (void *)my_disable_thread_library_calls;
  /* Plain Windows functions (GetTickCount, GlobalAlloc, GlobalFree, GetCursorPos): the real ones. */
  HMODULE m = LoadLibraryA(dll);
  return m ? (void *)GetProcAddress(m, fn) : NULL;
}

static BYTE *load_plugin(const char *path, void **rib_main) {
  FILE *fp = fopen(path, "rb");
  if (!fp) { fprintf(stderr, "cannot open %s\n", path); return NULL; }
  fseek(fp, 0, SEEK_END); long size = ftell(fp); fseek(fp, 0, SEEK_SET);
  BYTE *file = malloc(size);
  if (fread(file, 1, size, fp) != (size_t)size) { fclose(fp); return NULL; }
  fclose(fp);
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)file;
  if (dos->e_magic != IMAGE_DOS_SIGNATURE) { fprintf(stderr, "not a Windows module\n"); return NULL; }
  IMAGE_NT_HEADERS32 *nt = (IMAGE_NT_HEADERS32 *)(file + dos->e_lfanew);
  if (nt->Signature != IMAGE_NT_SIGNATURE || nt->FileHeader.Machine != IMAGE_FILE_MACHINE_I386) { fprintf(stderr, "not a 32-bit x86 module\n"); return NULL; }
  DWORD img = nt->OptionalHeader.SizeOfImage;
  BYTE *base = VirtualAlloc((void *)(ULONG_PTR)nt->OptionalHeader.ImageBase, img, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
  if (!base) base = VirtualAlloc(NULL, img, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
  if (!base) { fprintf(stderr, "out of memory\n"); return NULL; }
  memcpy(base, file, nt->OptionalHeader.SizeOfHeaders);
  IMAGE_SECTION_HEADER *sec = IMAGE_FIRST_SECTION(nt);
  for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    if (sec[i].SizeOfRawData) memcpy(base + sec[i].VirtualAddress, file + sec[i].PointerToRawData, min(sec[i].SizeOfRawData, sec[i].Misc.VirtualSize ? sec[i].Misc.VirtualSize : sec[i].SizeOfRawData));
  /* Relocations, if not at the preferred address. */
  DWORD delta = (DWORD)(ULONG_PTR)base - nt->OptionalHeader.ImageBase;
  IMAGE_DATA_DIRECTORY *rd = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_BASERELOC];
  if (delta && rd->Size) {
    BYTE *p = base + rd->VirtualAddress, *end = p + rd->Size;
    while (p < end) {
      IMAGE_BASE_RELOCATION *blk = (IMAGE_BASE_RELOCATION *)p;
      if (!blk->SizeOfBlock) break;
      WORD *e = (WORD *)(blk + 1);
      for (DWORD k = 0; k < (blk->SizeOfBlock - sizeof(*blk)) / 2; k++)
        if ((e[k] >> 12) == IMAGE_REL_BASED_HIGHLOW) *(DWORD *)(base + blk->VirtualAddress + (e[k] & 0xfff)) += delta;
      p += blk->SizeOfBlock;
    }
  }
  /* Imports. */
  IMAGE_DATA_DIRECTORY *id = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  for (IMAGE_IMPORT_DESCRIPTOR *d = (IMAGE_IMPORT_DESCRIPTOR *)(base + id->VirtualAddress); id->Size && d->Name; d++) {
    const char *dll = (const char *)(base + d->Name);
    IMAGE_THUNK_DATA32 *names = (IMAGE_THUNK_DATA32 *)(base + (d->OriginalFirstThunk ? d->OriginalFirstThunk : d->FirstThunk));
    IMAGE_THUNK_DATA32 *iat = (IMAGE_THUNK_DATA32 *)(base + d->FirstThunk);
    for (; names->u1.AddressOfData; names++, iat++) {
      if (names->u1.Ordinal & IMAGE_ORDINAL_FLAG32) { fprintf(stderr, "import by ordinal from %s not supported\n", dll); return NULL; }
      const char *fn = (const char *)((IMAGE_IMPORT_BY_NAME *)(base + names->u1.AddressOfData))->Name;
      void *addr = resolve(dll, fn);
      if (!addr) { fprintf(stderr, "plugin needs %s!%s, which this helper does not supply\n", dll, fn); return NULL; }
      iat->u1.Function = (DWORD)(ULONG_PTR)addr;
    }
  }
  /* Run the plugin's start-up code (DllMain: sets up its compiler security cookie). */
  if (nt->OptionalHeader.AddressOfEntryPoint) {
    BOOL (WINAPI *dllmain)(HINSTANCE, DWORD, LPVOID) = (void *)(base + nt->OptionalHeader.AddressOfEntryPoint);
    dllmain((HINSTANCE)base, DLL_PROCESS_ATTACH, NULL);
  }
  /* Export _RIB_Main@20. */
  IMAGE_DATA_DIRECTORY *ed = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
  IMAGE_EXPORT_DIRECTORY *ex = (IMAGE_EXPORT_DIRECTORY *)(base + ed->VirtualAddress);
  DWORD *fnames = (DWORD *)(base + ex->AddressOfNames), *funcs = (DWORD *)(base + ex->AddressOfFunctions);
  WORD *ords = (WORD *)(base + ex->AddressOfNameOrdinals);
  *rib_main = NULL;
  for (DWORD i = 0; ed->Size && i < ex->NumberOfNames; i++)
    if (!strcmp((const char *)(base + fnames[i]), "_RIB_Main@20")) *rib_main = base + funcs[ords[i]];
  free(file);
  return *rib_main ? base : NULL;
}

/* ---------- decoding ---------- */
typedef u32(__stdcall *PROPERTY_FN)(u32 index, void *before, const void *value, void *after);
typedef u32(__stdcall *STARTUP_FN)(void);
typedef u32(__stdcall *FETCH_CB)(u32 user, void *dest, int bytes, int offset);
typedef u32(__stdcall *OPEN_FN)(u32 alloc, u32 free_, u32 user, FETCH_CB fetch, u32 total);
typedef int(__stdcall *PROCESS_FN)(u32 stream, void *buffer, int bytes);

typedef struct { u32 id; u32 handle; const BYTE *src; u32 len, pos; } Decoder;
static Decoder decs[256];
static int ndecs = 0;
static OPEN_FN stream_open;
static PROCESS_FN stream_process;

static u32 __stdcall fetch(u32 user, void *dest, int bytes, int offset) {
  (void)offset;
  Decoder *d = &decs[user];
  u32 n = d->len - d->pos;
  if ((u32)bytes < n) n = bytes;
  if (n) memcpy(dest, d->src + d->pos, n);
  d->pos += n;
  return n;
}

static Decoder *decoder(u32 id) {
  for (int i = 0; i < ndecs; i++) if (decs[i].id == id) return &decs[i];
  if (ndecs == 256) return NULL;
  Decoder *d = &decs[ndecs];
  memset(d, 0, sizeof(*d));
  d->id = id;
  d->handle = stream_open(0, 0, (u32)ndecs, fetch, 0);
  if (!d->handle) return NULL;
  ndecs++;
  return d;
}

static void set_windows_fpu(void) {
  /* Windows' default FPU control word: all exceptions masked, 53-bit precision (the plugin was built for it). */
  unsigned short cw = 0x027F;
  __asm__ volatile("fldcw %0" : : "m"(cw));
}

static int read_all(BYTE **out, size_t *len) {
  size_t cap = 1 << 20, n = 0;
  BYTE *b = malloc(cap);
  for (;;) {
    size_t r = fread(b + n, 1, cap - n, stdin);
    n += r;
    if (r == 0) break;
    if (n == cap) { cap *= 2; b = realloc(b, cap); }
  }
  *out = b; *len = n;
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 2) { fprintf(stderr, "usage: cdf-voice-helper <path to mssvoice.asi>\n"); return 2; }
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  set_windows_fpu();
  void *rib_main_ptr;
  if (!load_plugin(argv[1], &rib_main_ptr)) return 3;
  u32(__stdcall *rib_main)(u32, u32, void *, void *, void *) = rib_main_ptr;
  provider(MAIN_HANDLE);
  rib_main(MAIN_HANDLE, 1, (void *)cb_alloc, (void *)cb_register, (void *)cb_unregister);
  set_windows_fpu();

  /* Find the provider whose input file type is ".V12 files" (VR12 decoder). */
  Provider *vr12 = NULL;
  for (int i = 0; i < nprov && !vr12; i++) {
    Interface *codec = iface(&providers[i], "ASI codec");
    u32 prop, tok, sub;
    if (!codec || !entry(codec, "PROVIDER_property", &prop, NULL) || !entry(codec, "Input file types", &tok, &sub)) continue;
    u32 value = 0;
    ((PROPERTY_FN)(ULONG_PTR)prop)(tok, &value, NULL, NULL);
    if (value && !strcmp((const char *)(ULONG_PTR)value, ".V12 files")) vr12 = &providers[i];
  }
  if (!vr12) { fprintf(stderr, "no VR12 voice decoder found in %s\n", argv[1]); return 4; }
  Interface *codec = iface(vr12, "ASI codec"), *stream = iface(vr12, "ASI stream");
  u32 t_start, t_open, t_proc;
  if (!stream || !entry(codec, "ASI_startup", &t_start, NULL) || !entry(stream, "ASI_stream_open", &t_open, NULL) || !entry(stream, "ASI_stream_process", &t_proc, NULL)) {
    fprintf(stderr, "VR12 decoder lacks stream functions\n");
    return 4;
  }
  ((STARTUP_FN)(ULONG_PTR)t_start)();
  stream_open = (OPEN_FN)(ULONG_PTR)t_open;
  stream_process = (PROCESS_FN)(ULONG_PTR)t_proc;

  BYTE *req; size_t len;
  read_all(&req, &len);
  if (len < 4) return 5;
  u32 count = *(u32 *)req;
  size_t p = 4;
  static BYTE out[1 << 16];
  BYTE *pcm = malloc(1 << 20);
  for (u32 k = 0; k < count; k++) {
    if (p + 8 > len) return 5;
    u32 id = *(u32 *)(req + p), n = *(u32 *)(req + p + 4);
    if (p + 8 + n > len) return 5;
    u32 total = 0;
    if (n) {
      Decoder *d = decoder(id);
      if (!d) { fprintf(stderr, "could not open a decoder\n"); return 4; }
      d->src = req + p + 8; d->len = n; d->pos = 0;
      for (;;) {
        int got = stream_process(d->handle, out, 4096);
        if (got <= 0) break;
        if (total + got > (1 << 20)) break;
        memcpy(pcm + total, out, got);
        total += got;
        if (d->pos >= d->len && got < 4096) break;
      }
    }
    fwrite(&total, 4, 1, stdout);
    if (total) fwrite(pcm, 1, total, stdout);
    p += 8 + n;
  }
  fflush(stdout);
  return 0;
}
