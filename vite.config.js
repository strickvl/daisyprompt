import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
export default defineConfig({
    plugins: [
        react(),
        // Enable ESM-style WebAssembly loading in both dev and build (including workers)
        wasm(),
        // Allow modules (including transformed WASM wrappers) to use top-level await in build output
        topLevelAwait(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    // Ensure .wasm files are treated as assets where needed
    assetsInclude: ['**/*.wasm'],
    // Avoid prebundling @dqbd/tiktoken with esbuild; it contains WASM and should be left to Vite + Rollup
    optimizeDeps: {
        exclude: ['@dqbd/tiktoken', '@dqbd/tiktoken/lite'],
    },
    worker: {
        // Use ES module format for workers; plugins above apply to worker bundles as well
        format: 'es',
    },
    build: {
        // Keep modern output to support top-level await and efficient WASM handling
        target: 'esnext',
        outDir: 'dist',
        sourcemap: true,
    },
    server: {
        port: 5173,
    },
});
