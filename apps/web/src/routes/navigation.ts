/** Primary navigation. Planned sections are visible with a badge and link to a placeholder. */
export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly status: 'live' | 'planned';
  readonly ticket?: string;
  readonly description?: string;
}

export interface NavGroup {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

export const NAVIGATION: readonly NavGroup[] = [
  {
    heading: 'Inventory',
    items: [
      { label: 'Stock on hand', path: '/stock', status: 'live' },
      { label: 'Allocations', path: '/allocations', status: 'live' },
      {
        label: 'Cycle counts',
        path: '/planned/cycle-counts',
        status: 'planned',
        ticket: 'SP-130',
        description: 'ABC-driven count plans, blind counts and variance approval.',
      },
      {
        label: 'Replenishment',
        path: '/planned/replenishment',
        status: 'planned',
        ticket: 'SP-140',
        description: 'Min/max rules that top up pick faces from reserve.',
      },
    ],
  },
  {
    heading: 'Inbound',
    items: [
      {
        label: 'ASNs & receiving',
        path: '/planned/receiving',
        status: 'planned',
        ticket: 'SP-071',
        description: 'Receive against advance shipping notices with discrepancy handling.',
      },
      {
        label: 'Putaway',
        path: '/planned/putaway',
        status: 'planned',
        ticket: 'SP-080',
        description: 'Directed putaway driven by slotting rules and bin capacity.',
      },
      {
        label: 'Returns',
        path: '/planned/returns',
        status: 'planned',
        ticket: 'SP-150',
        description: 'RMA authorisation, receipt and disposition.',
      },
    ],
  },
  {
    heading: 'Outbound',
    items: [
      {
        label: 'Orders & waves',
        path: '/planned/waves',
        status: 'planned',
        ticket: 'SP-092',
        description: 'Group orders into waves by carrier cut-off and release pick work.',
      },
      {
        label: 'Picking',
        path: '/planned/picking',
        status: 'planned',
        ticket: 'SP-100',
        description: 'Optimised pick paths and mobile pick confirmation.',
      },
      {
        label: 'Packing',
        path: '/planned/packing',
        status: 'planned',
        ticket: 'SP-111',
        description: '3D cartonization and pack-station verification.',
      },
      {
        label: 'Shipping',
        path: '/planned/shipping',
        status: 'planned',
        ticket: 'SP-120',
        description: 'Shipments, manifests and ship confirmation.',
      },
    ],
  },
  {
    heading: 'Setup',
    items: [
      {
        label: 'Labels',
        path: '/planned/labels',
        status: 'planned',
        ticket: 'SP-160',
        description: 'Code128 bin, carton and shipping labels rendered as SVG.',
      },
      {
        label: 'Reports',
        path: '/planned/reports',
        status: 'planned',
        ticket: 'SP-171',
        description: 'Inventory aging, expiry exposure and throughput dashboards.',
      },
      {
        label: 'Users & roles',
        path: '/planned/users',
        status: 'planned',
        ticket: 'SP-015',
        description: 'Invite users and manage role-based permissions.',
      },
    ],
  },
];

export function findPlanned(slug: string): NavItem | undefined {
  return NAVIGATION.flatMap((group) => group.items).find(
    (item) => item.status === 'planned' && item.path === `/planned/${slug}`,
  );
}
