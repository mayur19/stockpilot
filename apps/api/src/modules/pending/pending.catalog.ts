/**
 * Endpoints that are part of the target API (docs/api/openapi.yaml, x-status: pending)
 * but not implemented yet. Each is registered so the surface matches the spec and
 * answers 501 with the backlog ticket that will deliver it.
 */
export interface PendingEndpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly ticket: string;
  readonly summary: string;
}

export const PENDING_ENDPOINTS: readonly PendingEndpoint[] = [
  // Identity & access
  {
    method: 'POST',
    path: '/api/v1/auth/verify-email',
    ticket: 'SP-009',
    summary: 'Email-verified signup via the local outbox',
  },
  { method: 'GET', path: '/api/v1/users', ticket: 'SP-015', summary: 'User management' },
  {
    method: 'POST',
    path: '/api/v1/users/invitations',
    ticket: 'SP-015',
    summary: 'User invitations',
  },
  {
    method: 'PATCH',
    path: '/api/v1/users/:userId',
    ticket: 'SP-015',
    summary: 'User role changes',
  },
  { method: 'GET', path: '/api/v1/roles', ticket: 'SP-016', summary: 'Custom role editor' },
  {
    method: 'POST',
    path: '/api/v1/auth/password-reset',
    ticket: 'SP-017',
    summary: 'Password reset',
  },
  { method: 'GET', path: '/api/v1/clients', ticket: 'SP-018', summary: '3PL client accounts' },
  { method: 'GET', path: '/api/v1/audit-events', ticket: 'SP-019', summary: 'Audit log browser' },
  // Topology & catalogue
  {
    method: 'PATCH',
    path: '/api/v1/warehouses/:warehouseId',
    ticket: 'SP-024',
    summary: 'Warehouse update',
  },
  {
    method: 'PATCH',
    path: '/api/v1/warehouses/:warehouseId/bins/:binId',
    ticket: 'SP-024',
    summary: 'Bin update and deactivation',
  },
  {
    method: 'POST',
    path: '/api/v1/warehouses/:warehouseId/bins/import',
    ticket: 'SP-021',
    summary: 'Bulk bin import',
  },
  {
    method: 'GET',
    path: '/api/v1/warehouses/:warehouseId/map',
    ticket: 'SP-023',
    summary: 'Warehouse map',
  },
  {
    method: 'PATCH',
    path: '/api/v1/skus/:skuId',
    ticket: 'SP-035',
    summary: 'SKU update and UoM versioning',
  },
  {
    method: 'POST',
    path: '/api/v1/skus/import',
    ticket: 'SP-033',
    summary: 'SKU catalogue import',
  },
  {
    method: 'GET',
    path: '/api/v1/skus/:skuId/serials',
    ticket: 'SP-032',
    summary: 'Serial number tracking',
  },
  // Inventory control
  { method: 'POST', path: '/api/v1/inventory/holds', ticket: 'SP-042', summary: 'Inventory holds' },
  {
    method: 'GET',
    path: '/api/v1/inventory/balances/as-of',
    ticket: 'SP-043',
    summary: 'Point-in-time stock query',
  },
  {
    method: 'POST',
    path: '/api/v1/inventory/snapshots',
    ticket: 'SP-044',
    summary: 'Ledger snapshots',
  },
  // Inbound
  { method: 'GET', path: '/api/v1/asns', ticket: 'SP-070', summary: 'Advance shipping notices' },
  { method: 'POST', path: '/api/v1/asns', ticket: 'SP-070', summary: 'ASN creation' },
  {
    method: 'POST',
    path: '/api/v1/asns/:asnId/receipts',
    ticket: 'SP-071',
    summary: 'Receiving against an ASN',
  },
  {
    method: 'POST',
    path: '/api/v1/asns/:asnId/close',
    ticket: 'SP-071',
    summary: 'ASN close with discrepancy report',
  },
  { method: 'POST', path: '/api/v1/inspections', ticket: 'SP-073', summary: 'Quality inspection' },
  // Putaway
  {
    method: 'POST',
    path: '/api/v1/putaway/suggestions',
    ticket: 'SP-080',
    summary: 'Directed putaway',
  },
  { method: 'GET', path: '/api/v1/putaway/tasks', ticket: 'SP-081', summary: 'Putaway tasks' },
  {
    method: 'POST',
    path: '/api/v1/putaway/tasks/:taskId/confirm',
    ticket: 'SP-081',
    summary: 'Putaway confirmation',
  },
  {
    method: 'GET',
    path: '/api/v1/slotting/recommendations',
    ticket: 'SP-082',
    summary: 'Velocity slotting',
  },
  // Outbound
  { method: 'GET', path: '/api/v1/orders', ticket: 'SP-090', summary: 'Outbound orders' },
  { method: 'POST', path: '/api/v1/orders', ticket: 'SP-090', summary: 'Outbound order intake' },
  {
    method: 'POST',
    path: '/api/v1/orders/:orderId/cancel',
    ticket: 'SP-091',
    summary: 'Order cancellation',
  },
  { method: 'GET', path: '/api/v1/waves', ticket: 'SP-092', summary: 'Wave planning' },
  { method: 'POST', path: '/api/v1/waves', ticket: 'SP-092', summary: 'Wave creation' },
  {
    method: 'POST',
    path: '/api/v1/waves/:waveId/release',
    ticket: 'SP-093',
    summary: 'Wave release',
  },
  // Picking
  {
    method: 'POST',
    path: '/api/v1/pick-paths',
    ticket: 'SP-100',
    summary: 'Pick path optimisation',
  },
  { method: 'GET', path: '/api/v1/pick-tasks', ticket: 'SP-101', summary: 'Pick tasks' },
  {
    method: 'POST',
    path: '/api/v1/pick-tasks/:taskId/confirm',
    ticket: 'SP-101',
    summary: 'Pick confirmation',
  },
  {
    method: 'POST',
    path: '/api/v1/pick-tasks/:taskId/short',
    ticket: 'SP-101',
    summary: 'Short pick handling',
  },
  // Packing & shipping
  { method: 'GET', path: '/api/v1/carton-types', ticket: 'SP-110', summary: 'Carton types' },
  { method: 'POST', path: '/api/v1/cartonization', ticket: 'SP-111', summary: 'Cartonization' },
  {
    method: 'POST',
    path: '/api/v1/pack-sessions',
    ticket: 'SP-112',
    summary: 'Pack station sessions',
  },
  { method: 'GET', path: '/api/v1/shipments', ticket: 'SP-120', summary: 'Shipments' },
  {
    method: 'POST',
    path: '/api/v1/shipments/:shipmentId/confirm',
    ticket: 'SP-123',
    summary: 'Ship confirmation',
  },
  {
    method: 'GET',
    path: '/api/v1/manifests/:manifestId',
    ticket: 'SP-120',
    summary: 'Shipping manifests',
  },
  {
    method: 'GET',
    path: '/api/v1/carrier-rates',
    ticket: 'SP-121',
    summary: 'Carrier rate tables',
  },
  // Counting & replenishment
  { method: 'GET', path: '/api/v1/cycle-counts', ticket: 'SP-130', summary: 'Cycle count plans' },
  {
    method: 'POST',
    path: '/api/v1/cycle-counts',
    ticket: 'SP-130',
    summary: 'Cycle count creation',
  },
  {
    method: 'POST',
    path: '/api/v1/cycle-counts/:countId/results',
    ticket: 'SP-131',
    summary: 'Count result entry',
  },
  {
    method: 'POST',
    path: '/api/v1/cycle-counts/:countId/approve',
    ticket: 'SP-132',
    summary: 'Variance approval',
  },
  {
    method: 'GET',
    path: '/api/v1/replenishment/rules',
    ticket: 'SP-140',
    summary: 'Min/max replenishment rules',
  },
  {
    method: 'POST',
    path: '/api/v1/replenishment/run',
    ticket: 'SP-141',
    summary: 'Replenishment run',
  },
  // Returns, labels, reporting
  { method: 'POST', path: '/api/v1/rmas', ticket: 'SP-150', summary: 'Return authorisations' },
  {
    method: 'POST',
    path: '/api/v1/rmas/:rmaId/receipts',
    ticket: 'SP-151',
    summary: 'Returns receiving',
  },
  { method: 'GET', path: '/api/v1/labels/bins/:binId', ticket: 'SP-161', summary: 'Bin labels' },
  {
    method: 'POST',
    path: '/api/v1/labels/barcode',
    ticket: 'SP-160',
    summary: 'Code128 barcode rendering',
  },
  {
    method: 'GET',
    path: '/api/v1/dashboards/operations',
    ticket: 'SP-170',
    summary: 'Operations dashboard',
  },
  {
    method: 'GET',
    path: '/api/v1/reports/inventory-aging',
    ticket: 'SP-171',
    summary: 'Inventory aging report',
  },
  {
    method: 'GET',
    path: '/api/v1/reports/ledger-export',
    ticket: 'SP-172',
    summary: 'Ledger CSV export',
  },
  {
    method: 'GET',
    path: '/api/v1/notifications',
    ticket: 'SP-173',
    summary: 'In-app notifications',
  },
  {
    method: 'GET',
    path: '/api/v1/billing/storage',
    ticket: 'SP-174',
    summary: '3PL storage billing',
  },
  { method: 'GET', path: '/api/v1/metrics', ticket: 'SP-180', summary: 'Operational metrics' },
];
