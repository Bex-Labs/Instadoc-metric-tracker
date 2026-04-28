// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  
  /* --- CUSTOM TIMEOUTS FOR SLOW NETWORKS --- */
  timeout: 120 * 1000,          // Gives the browser 2 full minutes to load the page
  expect: { timeout: 15000 },   // Gives assertions 15 seconds to pass
  
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'https://instadoc-metric-tracker.vercel.app/',
    trace: 'on-first-retry',
  },

  /* --- ONLY USING THE CHROMIUM BROWSER YOU DOWNLOADED --- */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox and WebKit have been completely removed to prevent the "Executable doesn't exist" errors.
  ],
});