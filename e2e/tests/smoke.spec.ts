import { expect, test } from '@playwright/test';

// Requires the seeded development database (./run.sh setup). Run with `./run.sh e2e`.
const OPERATOR = { email: 'operator@stockpilot.test', password: 'stockpilot-demo-2026' };

test('operator signs in and sees stock on hand by bin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Stock on hand' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MILK-UHT-1L' }).first()).toBeVisible();
  await expect(page.getByRole('form', { name: 'Receive stock' })).toBeVisible();
});

test('planned sections are visible with a badge', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: /Picking/ }).click();
  await expect(page.getByText('SP-100')).toBeVisible();
});
