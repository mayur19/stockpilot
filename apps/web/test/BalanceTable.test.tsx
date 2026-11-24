import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Sku, StockBalance } from '../src/api/types';
import { BalanceTable } from '../src/pages/stock/BalanceTable';

const sku: Sku = {
  id: 's1',
  code: 'MILK-UHT-1L',
  description: 'Milk',
  baseUom: 'EA',
  uomLevels: [
    { code: 'CS', factor: 12 },
    { code: 'PL', factor: 480 },
  ],
  lotTracked: true,
  expiryTracked: true,
  defaultStrategy: 'FEFO',
};

const row = (overrides: Partial<StockBalance>): StockBalance => ({
  binId: 'b1',
  binCode: 'A-01-01-1-A',
  zoneCode: 'A',
  skuId: 's1',
  skuCode: 'MILK-UHT-1L',
  skuDescription: 'Milk',
  baseUom: 'EA',
  lotId: 'l1',
  lotCode: 'M1',
  expiryDate: '2026-06-10',
  onHand: 1000,
  allocated: 12,
  available: 988,
  ...overrides,
});

describe('BalanceTable', () => {
  const today = new Date('2026-06-01T12:00:00Z');

  it('renders an empty state', () => {
    render(<BalanceTable balances={[]} skus={new Map()} />);
    expect(screen.getByText(/no stock matches/i)).toBeInTheDocument();
  });

  it('shows quantities with a pack breakdown and flags expiry', () => {
    render(
      <BalanceTable
        balances={[
          row({}),
          row({
            binId: 'b2',
            lotId: 'l2',
            lotCode: 'OLD',
            expiryDate: '2026-05-30',
            available: 0,
            onHand: 5,
            allocated: 5,
          }),
        ]}
        skus={new Map([[sku.id, sku]])}
        today={today}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('2 PL + 2 CS + 4 EA')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('2026-06-10')).toHaveClass('warn');
    expect(within(rows[2] as HTMLElement).getByText('2026-05-30')).toHaveClass('danger');
  });

  it('offers a move action only when stock is available', () => {
    const onMove = vi.fn();
    render(
      <BalanceTable
        balances={[row({}), row({ binId: 'b2', available: 0 })]}
        skus={new Map([[sku.id, sku]])}
        onMove={onMove}
        today={today}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Move' });
    expect(buttons[1]).toBeDisabled();
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ binId: 'b1' }));
  });
});
