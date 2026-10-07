import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `vite dev` serve a raiz do app; a demo do host fica em /demo/index.html.
// `vite build` gera a biblioteca: um único arquivo ES com React embutido.
export default defineConfig(({ command }) => ({
  plugins: [react()],
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
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'happy-dom',
    css: { include: [/.+/] },
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
