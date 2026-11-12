import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/extension', outputDir: './extension-test-results', timeout: 30000, workers: 1 });
