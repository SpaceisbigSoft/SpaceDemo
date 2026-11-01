// Unit tests (npm test). Skips build output and the helpers' fetched sources (e.g. whisper.cpp's own tests).
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'helpers/**', 'out/**', 'dist/**'],
  },
});
