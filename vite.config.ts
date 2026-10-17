import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Not hosted on Vercel, so the commit SHA is stamped into the bundle at build time.
function commitSha(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  define: { __COMMIT_SHA__: JSON.stringify(commitSha()) },
  test: { include: ['src/**/*.test.ts'], exclude: ['.claude/**', 'node_modules/**'] },
});
