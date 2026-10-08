import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Publica a demo junto do bundle: `dist/index.html` e `dist/demo/index.html`,
 * trocando o import de dev (`../src/element.tsx`) pelo bundle já construído.
 */
function emitDemo(): Plugin {
  return {
    name: 'gmill-emit-demo',
    apply: 'build',
    generateBundle() {
      const html = readFileSync(new URL('./demo/index.html', import.meta.url), 'utf8');
      const targets = { 'index.html': './gmill-carteira.js', 'demo/index.html': '../gmill-carteira.js' };
      for (const [fileName, bundle] of Object.entries(targets)) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: html.replace('../src/element.tsx', bundle),
        });
      }
    },
  };
}

// `vite dev` serve a raiz do app; a demo do host fica em /demo/index.html.
// `vite build` gera a biblioteca: um único arquivo ES com React embutido.
export default defineConfig(({ command }) => ({
  plugins: [react(), emitDemo()],
  // React embutido (sem `external`). Em library mode o Vite não substitui
  // NODE_ENV sozinho, então fixamos para produção.
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/element.tsx',
      formats: ['es' as const],
      fileName: () => 'gmill-carteira.js',
    },
    cssCodeSplit: false,
  },
  server: {
    fs: { allow: ['..'] },
    // Mesmo caminho do nginx da imagem: /api/* vai para a API do Compose.
    proxy: {
      '/api': { target: 'http://localhost:39000', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'happy-dom',
    css: { include: [/.+/] },
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
