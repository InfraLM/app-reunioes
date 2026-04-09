import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  // Em desenvolvimento, use `vercel dev` para servir o frontend e as funções
  // serverless da pasta api/ na mesma porta (geralmente http://localhost:3000).
  // O Vercel CLI gerencia o roteamento de /api/* automaticamente.
})
