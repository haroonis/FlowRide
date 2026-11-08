import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Preact (3 KB) stands in for React (~60 KB gzipped). The code is still written against the React API.
const preact = {
  'react-dom/client': 'preact/compat/client',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
  react: 'preact/compat',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: preact },
  build: { sourcemap: false, target: 'es2020', cssMinify: true },
});
