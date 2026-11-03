import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: ['e2e/**/*.spec.mjs', 'protocol/**/*.spec.mjs'],
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 2,
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: 'list',
    outputDir: 'test-results',
    use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1000, height: 700 },
        actionTimeout: 10_000,
        navigationTimeout: 10_000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
