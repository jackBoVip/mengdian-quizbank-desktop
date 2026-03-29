import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (...segments: string[]) => resolve(__dirname, ...segments);

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': root('src/main'),
        '@shared': root('src/shared')
      }
    },
    build: {
      outDir: 'dist/main'
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: {
        '@shared': root('src/shared')
      }
    },
    build: {
      outDir: 'dist/preload'
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: root('src/renderer'),
    base: './',
    resolve: {
      alias: {
        '@renderer': root('src/renderer/src'),
        '@shared': root('src/shared')
      }
    },
    build: {
      outDir: root('dist/renderer'),
      emptyOutDir: true
    },
    plugins: [react()]
  }
});
