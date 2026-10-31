/* Allocator (zeroed blocks with a size header and a free list) and string functions for the WebAssembly build. */
#include "shim.h"
extern unsigned char __heap_base;
static unsigned char *top = 0;
static size_t *freelist = 0; /* each free block: [size][next] */
void *memcpy(void *d, const void *s, size_t n) { unsigned char *a = d; const unsigned char *b = s; while (n--) *a++ = *b++; return d; }
void *memmove(void *d, const void *s, size_t n) { unsigned char *a = d; const unsigned char *b = s; if (a < b) while (n--) *a++ = *b++; else { a += n; b += n; while (n--) *--a = *--b; } return d; }
void *memset(void *d, int c, size_t n) { unsigned char *a = d; while (n--) *a++ = (unsigned char)c; return d; }
void *sp_alloc(int size) {
  size_t need = ((size_t)size + 15) & ~(size_t)15;
  size_t **pp = (size_t **)&freelist;
  while (*pp) { size_t *blk = *pp; if (blk[0] >= need) { *pp = (size_t *)blk[1]; memset(blk + 2, 0, blk[0]); return blk + 2; } pp = (size_t **)&blk[1]; }
  if (!top) top = (unsigned char *)(((size_t)&__heap_base + 15) & ~(size_t)15);
  size_t *blk = (size_t *)top;
  size_t bytes = need + 2 * sizeof(size_t);
  size_t pages = __builtin_wasm_memory_size(0);
  size_t end = (size_t)top + bytes;
  if (end > pages * 65536) __builtin_wasm_memory_grow(0, (end - pages * 65536 + 65535) / 65536);
  top += (bytes + 15) & ~(size_t)15;
  blk[0] = need; memset(blk + 2, 0, need);
  return blk + 2;
}
void sp_free(void *p) { if (!p) return; size_t *blk = (size_t *)p - 2; blk[1] = (size_t)freelist; freelist = blk; }
