/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// vercel.json is the single source of truth for security headers; `vite preview`
// serves the same headers so the production CSP is exercised locally and in e2e tests.
interface VercelHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: VercelHeaderRule[];
};
const securityHeaders = Object.fromEntries(
  vercel.headers.find((rule) => rule.source === '/(.*)')!.headers.map((h) => [h.key, h.value]),
);
// HSTS is meaningless over plain-http localhost.
delete securityHeaders['Strict-Transport-Security'];

export default defineConfig({
  build: {
    target: ['chrome100', 'safari16'],
    // heic-to is ~3 MB but is only ever loaded on demand for HEIC uploads.
    chunkSizeWarningLimit: 4000,
  },
  preview: {
    headers: securityHeaders,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
