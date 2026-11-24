import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { balance, bins, milk, ok, routeFetch } from './fixtures';

afterEach(() => vi.restoreAllMocks());

const me = {
  user: { id: 'u1', email: 'm@x', name: 'Marco', role: 'manager' },
  organization: { id: 'o1', name: 'Northwind' },
};
const warehouses = [{ id: 'w1', code: 'LDN1', name: 'London', timezone: 'Europe/London' }];
const allocation = {
  id: 'a1',
  orderRef: 'SO-100',
  status: 'ALLOCATED',
  shipComplete: false,
  createdAt: '2026-06-01T10:00:00Z',
  lines: [
    {
      lineNo: 1,
      skuCode: 'MILK-UHT-1L',
      strategy: 'FEFO',
      requested: 12,
      allocated: 12,
      picks: [{ binCode: 'A-01-01-1-A', lotCode: 'M1', expiryDate: '2099-01-01', quantity: 12 }],
    },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const baseRoutes = {
  'GET /api/v1/auth/me': () => ok(me),
  'GET /api/v1/warehouses': () => ok(warehouses),
  'GET /api/v1/warehouses/w1/bins': () => ok(bins),
  'GET /api/v1/skus': () => ok([milk]),
  'GET /api/v1/inventory/balances': () => ok([balance]),
  'GET /api/v1/allocations': () => ok([allocation]),
  'GET /api/v1/allocations/a1': () => ok(allocation),
  'POST /api/v1/allocations/a1/release': () => ok({ ...allocation, status: 'RELEASED' }),
  'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
};

describe('authenticated app', () => {
  it('redirects anonymous users to the login page', async () => {
    routeFetch({});
    renderAt('/stock');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows stock on hand with filters and opens the move form', async () => {
    const { calls } = routeFetch(baseRoutes);
    renderAt('/stock');
    expect(await screen.findByRole('heading', { name: 'Stock on hand' })).toBeInTheDocument();
    expect(await screen.findByText('2 CS')).toBeInTheDocument();
    expect(screen.getAllByText('Planned').length).toBeGreaterThan(5);
    fireEvent.change(screen.getAllByLabelText('SKU')[0] as HTMLElement, {
      target: { value: 's1' },
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('skuId=s1'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(await screen.findByRole('form', { name: 'Move stock' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('form', { name: 'Receive stock' })).toBeInTheDocument();
  });

  it('lists allocations, shows picks and releases', async () => {
    routeFetch(baseRoutes);
    renderAt('/allocations');
    fireEvent.click(await screen.findByRole('button', { name: 'SO-100' }));
    const detail = await screen.findByRole('region', { name: 'Allocation SO-100' });
    expect(within(detail).getByText('A-01-01-1-A')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(within(detail).getByText('RELEASED')).toBeInTheDocument());
  });

  it('signs out from the top bar', async () => {
    routeFetch(baseRoutes);
    renderAt('/planned/waves');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
