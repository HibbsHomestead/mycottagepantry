import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  cacheDir: 'node_modules/.cache/workspace-browser-fixture',
  optimizeDeps: {
    entries: ['src/test/capture-workspace.tsx'],
    exclude: ['@tanstack/react-start/server'],
  },
  resolve: { tsconfigPaths: true },
  define: { __APP_VERSION__: JSON.stringify('workspace-browser-fixture') },
  server: { hmr: false },
  plugins: [tailwindcss(), react()],
})
