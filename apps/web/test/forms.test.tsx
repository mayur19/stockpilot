import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllocationForm } from '../src/pages/allocations/AllocationForm';
import { MoveForm } from '../src/pages/stock/MoveForm';
import { ReceiveForm } from '../src/pages/stock/ReceiveForm';
import { balance, bins, fail, milk, ok, routeFetch, tee } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('ReceiveForm', () => {
  it('asks for lot and expiry only for tracked SKUs and posts pack units', async () => {
    const { calls } = routeFetch({
      'POST /api/v1/inventory/receipts': () =>
        ok({ quantityDescription: '2 CS', lot: { lotCode: 'L9' } }, 201),
    });
    const onDone = vi.fn();
    render(<ReceiveForm warehouseId="w1" bins={bins} skus={[milk, tee]} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 's2' } });
    expect(screen.queryByLabelText('Lot code')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Bin'), { target: { value: 'b1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'CS' } });
    fireEvent.change(screen.getByLabelText('Lot code'), { target: { value: 'L9' } });
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2099-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Received 2 CS of MILK-UHT-1L (lot L9)'),
    );
    expect(calls[0]?.body).toEqual({
      warehouseId: 'w1',
      binId: 'b1',
      skuId: 's1',
      quantity: 2,
      uom: 'CS',
      lotCode: 'L9',
      expiryDate: '2099-01-01',
    });
  });

  it('shows API errors', async () => {
    routeFetch({
      'POST /api/v1/inventory/receipts': () => fail(409, 'LOT_EXPIRY_MISMATCH', 'Lot L9 differs'),
    });
    render(<ReceiveForm warehouseId="w1" bins={bins} skus={[tee]} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 's2' } });
    fireEvent.change(screen.getByLabelText('Bin'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lot L9 differs');
  });
});

describe('MoveForm', () => {
  it('excludes the source bin and posts the move', async () => {
    const { calls } = routeFetch({
      'POST /api/v1/inventory/moves': () => ok({ movementId: 1 }, 201),
    });
    const onDone = vi.fn();
    render(
      <MoveForm
        warehouseId="w1"
        source={balance}
        bins={bins}
        sku={milk}
        onDone={onDone}
        onCancel={vi.fn()}
      />,
    );
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith('A-01-01-1-A'))).toBe(false);
    fireEvent.change(screen.getByLabelText('To bin'), { target: { value: 'b2' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'CS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith(
        'Moved 1 CS of MILK-UHT-1L from A-01-01-1-A to A-01-02-1-A',
      ),
    );
    expect(calls[0]?.body).toMatchObject({
      fromBinId: 'b1',
      toBinId: 'b2',
      lotId: 'l1',
      quantity: 1,
      uom: 'CS',
    });
  });

  it('reports insufficient stock and can be cancelled', async () => {
    routeFetch({
      'POST /api/v1/inventory/moves': () =>
        fail(409, 'INSUFFICIENT_AVAILABLE', 'Not enough available stock in bin'),
    });
    const onCancel = vi.fn();
    render(
      <MoveForm
        warehouseId="w1"
        source={balance}
        bins={bins}
        sku={milk}
        onDone={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText('To bin'), { target: { value: 'b2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough available stock');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('AllocationForm', () => {
  it('sends strategy, shelf life and ship-complete options', async () => {
    const allocation = {
      id: 'a1',
      orderRef: 'SO-1',
      status: 'ALLOCATED',
      shipComplete: true,
      createdAt: '',
      lines: [],
    };
    const { calls } = routeFetch({ 'POST /api/v1/allocations': () => ok(allocation, 201) });
    const onAllocated = vi.fn();
    render(<AllocationForm warehouseId="w1" skus={[milk]} onAllocated={onAllocated} />);
    fireEvent.change(screen.getByLabelText('Order reference'), { target: { value: 'SO-1' } });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'FIFO' } });
    fireEvent.change(screen.getByLabelText('Min shelf life (days)'), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Ship complete (all or nothing)'));
    fireEvent.click(screen.getByRole('button', { name: 'Allocate' }));
    await waitFor(() => expect(onAllocated).toHaveBeenCalledWith(allocation));
    expect(calls[0]?.body).toEqual({
      warehouseId: 'w1',
      orderRef: 'SO-1',
      shipComplete: true,
      strategy: 'FIFO',
      minShelfLifeDays: 7,
      lines: [{ skuId: 's1', quantity: 3, uom: 'EA' }],
    });
  });

  it('shows shortfall errors', async () => {
    routeFetch({
      'POST /api/v1/allocations': () =>
        fail(409, 'INSUFFICIENT_STOCK', 'Not enough eligible stock to allocate this order'),
    });
    render(<AllocationForm warehouseId="w1" skus={[milk]} onAllocated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Order reference'), { target: { value: 'SO-2' } });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allocate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough eligible stock');
  });
});
