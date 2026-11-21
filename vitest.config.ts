import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Agent worktrees under .claude/ carry their own copy of the tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
