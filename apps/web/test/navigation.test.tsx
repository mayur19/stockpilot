import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { describeQuantity, daysUntil } from '../src/format';
import { PlannedPage } from '../src/pages/PlannedPage';
import { findPlanned, NAVIGATION } from '../src/routes/navigation';

describe('navigation', () => {
  it('has the live slice screens and ticketed planned sections', () => {
    const items = NAVIGATION.flatMap((g) => g.items);
    expect(items.filter((i) => i.status === 'live').map((i) => i.path)).toEqual([
      '/stock',
      '/allocations',
    ]);
    for (const item of items.filter((i) => i.status === 'planned')) {
      expect(item.ticket).toMatch(/^SP-\d{3}$/);
      expect(item.path.startsWith('/planned/')).toBe(true);
    }
    expect(findPlanned('waves')?.ticket).toBe('SP-092');
    expect(findPlanned('stock')).toBeUndefined();
  });

  it('renders a planned placeholder with its ticket', () => {
    render(
      <MemoryRouter initialEntries={['/planned/picking']}>
        <Routes>
          <Route path="/planned/:slug" element={<PlannedPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /picking/i })).toBeInTheDocument();
    expect(screen.getByText('SP-100')).toBeInTheDocument();
  });

  it('falls back for unknown planned slugs', () => {
    render(
      <MemoryRouter initialEntries={['/planned/unknown']}>
        <Routes>
          <Route path="/planned/:slug" element={<PlannedPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /planned feature/i })).toBeInTheDocument();
  });
});

describe('format helpers', () => {
  it('describes quantities using the SKU ladder', () => {
    const sku = { baseUom: 'EA', uomLevels: [{ code: 'CS', factor: 12 }] };
    expect(describeQuantity(30, sku)).toBe('2 CS + 6 EA');
    expect(describeQuantity(0, sku)).toBe('0 EA');
    expect(describeQuantity(5, undefined)).toBe('5');
  });

  it('counts calendar days until a date', () => {
    expect(daysUntil('2026-06-03', new Date('2026-06-01T23:00:00Z'))).toBe(2);
    expect(daysUntil('2026-05-31', new Date('2026-06-01T01:00:00Z'))).toBe(-1);
  });
});
