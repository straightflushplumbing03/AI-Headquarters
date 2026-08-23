import { test, expect } from '@playwright/test'

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/AI Headquarters/)
  await expect(page.locator('h1')).toContainText('AI Headquarters')
})

test('sign up page loads', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

test('sign in page loads', async ({ page }) => {
  await page.goto('/auth/signin')
  await expect(page.locator('input[type="email"]')).toBeVisible()
})
