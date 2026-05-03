import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3001';

test('audit UI against requirements', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1. Sidebar menu?
  const sidebar = page.locator('aside');
  await expect(sidebar).toBeVisible();
  const navButtons = sidebar.locator('button');
  const count = await navButtons.count();
  console.log(`[AUDIT] Sidebar found: ${count} nav items`);
  expect(count).toBeGreaterThanOrEqual(5);

  // 2. Pipeline?
  // First enter a repo to trigger dashboard
  const input = page.locator('input[placeholder*="github"]');
  await expect(input).toBeVisible();
  await input.fill('github.com/codenexus/test');
  await page.locator('button:has-text("Analyze")').click();
  await page.waitForTimeout(500);

  // Check pipeline exists
  const pipelineHeading = page.getByText('Pipeline');
  await expect(pipelineHeading).toBeVisible({ timeout: 3000 });
  console.log('[AUDIT] Pipeline section: VISIBLE');

  // 3. Upload zone?
  const uploadZone = page.locator('.upload-zone');
  await expect(uploadZone).toBeVisible();
  console.log('[AUDIT] Upload/Repo zone: VISIBLE');

  // 4. Glows and animations?
  // Check for glow class usage
  const glowElements = page.locator('[class*="glow"]');
  const glowCount = await glowElements.count();
  console.log(`[AUDIT] Glow elements: ${glowCount}`);

  const animatedElements = page.locator('[class*="animate"]');
  const animCount = await animatedElements.count();
  console.log(`[AUDIT] Animated elements: ${animCount}`);

  // 5. Skeuomorphic feel?
  const glassPanels = page.locator('.glass-panel');
  const glassCount = await glassPanels.count();
  console.log(`[AUDIT] Glass panels: ${glassCount}`);

  const skeuoCards = page.locator('.skeuo-card');
  const skeuoCount = await skeuoCards.count();
  console.log(`[AUDIT] Skeuo cards: ${skeuoCount}`);

  // 6. Take full page screenshot
  await page.screenshot({ path: 'test-results/ui-audit.png', fullPage: true });
  console.log('[AUDIT] Screenshot saved: test-results/ui-audit.png');

  // 7. Check the overall structure
  console.log('[AUDIT] Page title:', await page.title());

  // Read the first few text elements to understand content
  const headings = page.locator('h1, h2, h3');
  const headingTexts = await headings.allTextContents();
  console.log('[AUDIT] Headings found:', headingTexts.slice(0, 10));

  const buttons = page.locator('button:visible');
  const buttonTexts = await buttons.allTextContents();
  console.log('[AUDIT] Buttons found:', buttonTexts.slice(0, 10));
});

test('assess skeuomorphic quality', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const input = page.locator('input[placeholder*="github"]');
  await expect(input).toBeVisible();
  await input.fill('github.com/codenexus/test');
  await page.locator('button:has-text("Analyze")').click();
  await page.waitForTimeout(800);

  // Check for realism markers
  const hasGradients = await page.locator('[class*="gradient"]').count();
  const hasShadows = await page.locator('[class*="shadow"]').count();
  const hasBackdropBlur = await page.locator('[class*="backdrop"]').count();
  const hasRounded = await page.locator('[class*="rounded"]').count();

  console.log(`[QUALITY] Gradient elements: ${hasGradients}`);
  console.log(`[QUALITY] Shadow elements: ${hasShadows}`);
  console.log(`[QUALITY] Backdrop blur elements: ${hasBackdropBlur}`);
  console.log(`[QUALITY] Rounded elements: ${hasRounded}`);

  // Check for physical material cues
  const hasInset = await page.locator('[class*="inset"]').count();
  const hasHover = await page.locator('[class*="hover:"]').count();
  console.log(`[QUALITY] Inset (depth cue): ${hasInset}`);
  console.log(`[QUALITY] Hover transitions: ${hasHover}`);

  // The honest verdict
  console.log('\n=== HONEST ASSESSMENT ===');
  if (hasGradients > 5 && hasShadows > 8 && hasBackdropBlur > 2) {
    console.log('Verdict: Strong glassmorphic/polished design, but NOT true skeuomorphism.');
    console.log('Missing: realistic 3D materials, tactile bevels, physical depth layers,');
    console.log('leather/metal textures, recessed panels, realistic lighting.');
  } else {
    console.log('Verdict: Basic dark themed UI, needs more depth and material cues.');
  }
});
