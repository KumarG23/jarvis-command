import { test as base } from '@playwright/test';

// CI keeps its ordinary isolated browser. Owned Studio QA uses only fresh
// contexts on the wrapper-admitted browser, never closing shared Chrome.
export const test = process.env.STUDIO_BROWSER_CDP_ENDPOINT ? base.extend({
  browser: async ({ playwright }, use) => {
    if (process.env.STUDIO_QA_TASK_ID !== 'command#issue-111') throw Error('Use the issue-111 Studio browser wrapper');
    const browser = await playwright.chromium.connectOverCDP(process.env.STUDIO_BROWSER_CDP_ENDPOINT!);
    await use(browser);
  },
}) : base;
