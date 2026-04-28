// tests/live-deployment.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Live Vercel Deployment Verification - IDC-65', () => {
  
  test('All core files are successfully deployed and return 200 OK status', async ({ request }) => {
    // 1. Proves there are no build errors and Vercel is serving all modules
    const routes = [
      '/',
      '/index.html',
      '/consultation.html',
      '/contact.html',
      '/app/index.html',     
      '/admin/index.html'    
    ];

    for (const route of routes) {
      const response = await request.get(route);
      expect(response.status()).toBe(200); 
    }
  });

  test('Public Landing Page is accessible and renders the DOM correctly', async ({ page }) => {
    // 2. Proves the main public frontend executes without critical UI crashes
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });

  test('Administrative Panel is accessible and renders the DOM correctly', async ({ page }) => {
    // 3. Proves the admin-specific module loads successfully on deployment
    await page.goto('/admin/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });
});