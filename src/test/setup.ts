/**
 * Vitest setup for every test file. The default environment stays `node`
 * (fast, and what the 50+ pure-logic suites expect); React/DOM suites opt in
 * per file with `// @vitest-environment jsdom` at the top.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(async () => {
  // Only meaningful under jsdom; importing RTL in node would pull in DOM globals.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
