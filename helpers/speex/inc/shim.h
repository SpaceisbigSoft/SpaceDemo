#ifndef SP_SHIM_H
#define SP_SHIM_H
/* Minimal C runtime for a freestanding WebAssembly build of the Speex decoder. */
typedef __SIZE_TYPE__ size_t;
#define NULL ((void*)0)
void *sp_alloc(int size);
void sp_free(void *p);
void *memcpy(void *d, const void *s, size_t n);
void *memmove(void *d, const void *s, size_t n);
void *memset(void *d, int c, size_t n);
static inline void *speex_alloc(int size) { return sp_alloc(size); }
static inline void *speex_alloc_scratch(int size) { return sp_alloc(size); }
static inline void *speex_realloc(void *ptr, int size) { (void)ptr; return sp_alloc(size); }
static inline void speex_free(void *ptr) { sp_free(ptr); }
static inline void speex_free_scratch(void *ptr) { sp_free(ptr); }
static inline void _speex_fatal(const char *str, const char *file, int line) { (void)str; (void)file; (void)line; __builtin_trap(); }
static inline int printf(const char *f, ...) { (void)f; return 0; }
static inline void speex_warning(const char *str) { (void)str; }
static inline void speex_warning_int(const char *str, int val) { (void)str; (void)val; }
static inline void speex_notify(const char *str) { (void)str; }
static inline void _speex_putc(int ch, void *file) { (void)ch; (void)file; }
#define SPEEX_COPY(dst, src, n) (memcpy((dst), (src), (n)*sizeof(*(dst)) + 0*((dst)-(src)) ))
#define SPEEX_MOVE(dst, src, n) (memmove((dst), (src), (n)*sizeof(*(dst)) + 0*((dst)-(src)) ))
#define SPEEX_MEMSET(dst, c, n) (memset((dst), (c), (n)*sizeof(*(dst))))
#endif
