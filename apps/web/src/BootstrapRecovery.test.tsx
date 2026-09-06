import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

it.each([
  [401, 'Sign-in required'],
  [403, 'Access denied'],
  [503, 'Command unavailable'],
  [200, 'Invalid server response'],
])('distinguishes bootstrap status/schema failure %s without rendering raw details', async (status, heading) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ private: 'LOCAL_PRIVATE_DETAIL' }, { status })));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(heading);
  expect(screen.queryByText(/LOCAL_PRIVATE_DETAIL/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
});

it('distinguishes a blocked redirect from an unclassified network failure', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ type: 'opaqueredirect' });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in required');
  expect(fetchMock).toHaveBeenCalledWith('/api/bootstrap', expect.objectContaining({ redirect: 'manual', cache: 'no-store' }));
});

it('does not claim a network failure is proof of an expired identity', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('LOCAL_PRIVATE_DETAIL')));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  expect(screen.getByText(/connection or sign-in may need attention/i)).toBeInTheDocument();
  expect(screen.queryByText(/LOCAL_PRIVATE_DETAIL/)).not.toBeInTheDocument();
});

it('provides a bounded remedy when browser recovery is refused', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error('LOCAL_PRIVATE_DETAIL')) } });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
  expect(await screen.findByText(/Browser recovery could not finish/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in again' })).toBeEnabled();
  expect(screen.queryByText(/LOCAL_PRIVATE_DETAIL/)).not.toBeInTheDocument();
});
