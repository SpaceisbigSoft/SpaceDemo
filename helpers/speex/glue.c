/* SpaceDemo's interface to the Speex narrowband decoder: one decoder state per voice stream (player). */
#include <speex/speex.h>
#include "shim.h"
typedef struct { void *st; SpeexBits bits; } Dec;
void *dec_new(void) { Dec *d = sp_alloc(sizeof(Dec)); d->st = speex_decoder_init(speex_lib_get_mode(SPEEX_MODEID_NB)); int on = 1; speex_decoder_ctl(d->st, SPEEX_SET_ENH, &on); speex_bits_init(&d->bits); return d; }
void dec_free(void *p) { Dec *d = p; speex_decoder_destroy(d->st); speex_bits_destroy(&d->bits); sp_free(d); }
/* Decodes one frame of `len` bytes into 160 samples at `out`; returns 0 when fine, -1 at end of stream, -2 when corrupt. */
int dec_frame(void *p, char *data, int len, short *out) { Dec *d = p; speex_bits_read_from(&d->bits, data, len); return speex_decode_int(d->st, &d->bits, out); }
/* Decodes a lost frame (packet loss concealment). */
int dec_lost(void *p, short *out) { Dec *d = p; return speex_decode_int(d->st, 0, out); }
void *buf(int size) { return sp_alloc(size); }
void unbuf(void *p) { sp_free(p); }
