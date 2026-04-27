const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 20000,
  expect: { timeout: 5000 },
  use: {
    headless: true,
    baseURL: `file:///${path.resolve(__dirname).replace(/\\/g, '/')}`,
  },
  reporter: [['line'], ['json', { outputFile: 'e2e-results.json' }]],
});
