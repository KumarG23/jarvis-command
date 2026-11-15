import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setAdmissionRetryDelays } from './useLiveTurn';

// Automatic admission retries are tested on their own; other tests see the first failure directly.
beforeEach(() => { sessionStorage.clear(); setAdmissionRetryDelays([]); });

afterEach(() => {
  cleanup();
});
