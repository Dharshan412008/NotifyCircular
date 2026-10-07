import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RouteBoundary from '../components/RouteBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('offers recovery when a screen fails to load', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenScreen() { throw new Error('Chunk unavailable'); }
  render(<RouteBoundary><BrokenScreen /></RouteBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('This screen could not open');
  expect(screen.getByRole('button', { name: 'Reload CampusRelay' })).toBeEnabled();
});
