import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  root,
  publicDir: path.join(root, 'public'),
  build: { outDir: path.join(root, 'dist'), emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1200 },
  server: {
    host: true, port: 5173, fs: { allow: [path.resolve(root, '..')] },
    proxy: { '/api': backend, '/music': backend, '/socket.io': { target: backend, ws: true } },
  },
});
