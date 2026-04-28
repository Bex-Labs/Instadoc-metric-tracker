const { test, expect } = require('@playwright/test');

const LOCAL_URL = 'http://127.0.0.1:5500'; 

const TEST_PATIENT_EMAIL = 'ibrahimadevize@gmail.com';
const TEST_DOCTOR_EMAIL = 'moses@gmail.com';
const TEST_PASSWORD = '1234567890';

test.describe('Instadoc Appointment Booking Flow (IDC-85)', () => {

  test('Test Case 1: Landing Page Quick-Book to Signup Transfer', async ({ page }) => {
    await page.goto(LOCAL_URL);
    
    const testName = 'John Doe';
    const testEmail = `johndoe_${Date.now()}@test.com`;
    
    await page.fill('#quick-name', testName);
    await page.fill('#quick-email', testEmail);
    await page.fill('#quick-phone', '555-0199');
    await page.click('button.btn-book-now');
    
    const signupModal = page.locator('#lp-signup-modal');
    await expect(signupModal).toBeVisible();
    const signupEmailField = page.locator('#lp-signup-email');
    await expect(signupEmailField).toHaveValue(testEmail);
  });

  test('Test Case 2: Full Patient Booking Flow (In-App)', async ({ page }) => {
    await page.goto(LOCAL_URL);
    await page.click('button.btn-login');
    await page.fill('#lp-login-email', TEST_PATIENT_EMAIL);
    await page.fill('#lp-login-password', TEST_PASSWORD);
    
    await Promise.all([
      page.waitForURL('**/app/index.html'),
      page.click('#lp-btn-login')
    ]);

    await expect(page.locator('#dashboard-view')).toBeVisible({ timeout: 15000 });

    // 1. Navigate to the Appointments tab and wait for visual confirmation
    await page.click('.nav-link:has-text("Appointments")');
    await expect(page.locator('#view-appointments')).toBeVisible();

    // 2. Click "Book Appointment" (Filtered for visible element to ignore mobile drawer)
    await page.locator('button:has-text("Book Appointment")').filter({ visible: true }).click();
    await expect(page.locator('#booking-modal')).toBeVisible();

    // 3. Select Doctor
    const firstDoctor = page.locator('#doctor-list-container .card').first();
    await firstDoctor.click();
    await expect(page.locator('#schedule-appointment-modal')).toBeVisible();

    // 4. Set Date (Future Weekday)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    if (futureDate.getDay() === 0 || futureDate.getDay() === 6) futureDate.setDate(futureDate.getDate() + 2);
    const dateString = futureDate.toISOString().split('T')[0];
    
    await page.fill('#schedule-date', dateString);
    await expect(page.locator('#schedule-time')).toBeEnabled();
    
    // 5. Random Time to prevent Database Conflict
    const randomHour = Math.floor(Math.random() * 6) + 10;
    const randomMinute = Math.floor(Math.random() * 60).toString().padStart(2, '0');
    await page.fill('#schedule-time', `${randomHour}:${randomMinute}`);

    await page.selectOption('#schedule-method', 'Video Call');
    await page.selectOption('#schedule-type', 'Follow-up');

    // 6. Submit
    await page.click('#schedule-form button[type="submit"]');

    await expect(page.locator('#schedule-success')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#schedule-success')).toContainText('Appointment Scheduled!');
  });

  test('Test Case 3: Schedule UI Validation (Doctor Availability)', async ({ page }) => {
    await page.goto(LOCAL_URL);
    await page.click('button.btn-login');
    await page.fill('#lp-login-email', TEST_PATIENT_EMAIL);
    await page.fill('#lp-login-password', TEST_PASSWORD);
    
    await Promise.all([
      page.waitForURL('**/app/index.html'),
      page.click('#lp-btn-login')
    ]);
    
    await page.click('.nav-link:has-text("Appointments")');
    await expect(page.locator('#view-appointments')).toBeVisible();
    
    await page.locator('button:has-text("Book Appointment")').filter({ visible: true }).click();
    await page.locator('#doctor-list-container .card').first().click();

    // Force a Sunday selection
    let sunday = new Date();
    sunday.setDate(sunday.getDate() + (7 - sunday.getDay())); 
    const sunDateString = sunday.toISOString().split('T')[0];
    
    await page.fill('#schedule-date', sunDateString);
    
    // Assert availability validation triggers
    await expect(page.locator('#schedule-time')).toBeDisabled();
    await expect(page.locator('#schedule-time-hint')).toBeVisible();
    await expect(page.locator('#schedule-time-hint')).toContainText('not available');
  });

  test('Test Case 4: Doctor Schedule Verification', async ({ page }) => {
    await page.goto(LOCAL_URL);
    await page.click('button.btn-login');
    await page.fill('#lp-login-email', TEST_DOCTOR_EMAIL); 
    await page.fill('#lp-login-password', TEST_PASSWORD);
    
    await Promise.all([
      page.waitForURL('**/app/index.html'),
      page.click('#lp-btn-login')
    ]);
    
    await expect(page.locator('#view-doctor-dashboard')).toBeVisible();

    await page.click('.nav-link:has-text("Appointments")');
    await expect(page.locator('#view-doctor-appointments')).toBeVisible();

    const pendingList = page.locator('#doc-pending-list');
    await expect(pendingList).toBeVisible();
  });

});