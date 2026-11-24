import { addDays, defaultPickSequence, parseBinCode, type ZoneType } from '@stockpilot/shared';
import type { Logger } from 'pino';
import { loadEnv } from '../config/env.js';
import type { AppContext, AuthContext } from '../context.js';
import { createAuthThrottle } from '../http/rate-limiter.js';
import { allocateOrder } from '../modules/allocation/allocation.service.js';
import * as authRepo from '../modules/auth/auth.repository.js';
import { hashPassword } from '../modules/auth/password.js';
import { insertSku, type SkuDto } from '../modules/catalog/catalog.repository.js';
import { moveStock, receiveStock, todayIn } from '../modules/inventory/inventory.service.js';
import * as topology from '../modules/topology/topology.repository.js';
import type { Db } from './pool.js';

/** Development-only credentials, documented in README.md. */
export const DEMO_PASSWORD = 'stockpilot-demo-2026';
export const DEMO_USERS = [
  { email: 'owner@stockpilot.test', name: 'Olivia Owner', role: 'owner' },
  { email: 'manager@stockpilot.test', name: 'Marco Manager', role: 'manager' },
  { email: 'operator@stockpilot.test', name: 'Priya Operator', role: 'operator' },
  { email: 'viewer@stockpilot.test', name: 'Victor Viewer', role: 'viewer' },
] as const;

const ZONES: { code: string; name: string; type: ZoneType; bins: string[] }[] = [
  { code: 'RCV', name: 'Receiving dock', type: 'RECEIVING', bins: ['RCV01', 'RCV02'] },
  {
    code: 'A',
    name: 'Ambient reserve',
    type: 'STORAGE',
    bins: ['01', '02', '03'].flatMap((aisle) =>
      ['01', '02', '03', '04'].map((rack) => `A-${aisle}-${rack}-1-A`),
    ),
  },
  {
    code: 'P',
    name: 'Forward pick',
    type: 'PICK',
    bins: ['01', '02', '03', '04', '05', '06'].map((rack) => `P-01-${rack}-0-A`),
  },
  { code: 'Q', name: 'Quarantine cage', type: 'QUARANTINE', bins: ['QCAGE1'] },
];

async function createSkus(db: Db, orgId: string): Promise<Record<string, SkuDto>> {
  const specs = [
    {
      code: 'MILK-UHT-1L',
      description: 'UHT whole milk 1L carton',
      baseUom: 'EA',
      uomLevels: [
        { code: 'CS', factor: 12 },
        { code: 'PL', factor: 480 },
      ],
      lotTracked: true,
      expiryTracked: true,
      defaultStrategy: 'FEFO' as const,
    },
    {
      code: 'VIT-D3-60',
      description: 'Vitamin D3 tablets, bottle of 60',
      baseUom: 'EA',
      uomLevels: [
        { code: 'IP', factor: 6 },
        { code: 'CS', factor: 48 },
      ],
      lotTracked: true,
      expiryTracked: true,
      defaultStrategy: 'FEFO' as const,
    },
    {
      code: 'BATT-AA-4',
      description: 'Alkaline AA batteries, 4-pack',
      baseUom: 'EA',
      uomLevels: [{ code: 'CS', factor: 24 }],
      lotTracked: true,
      expiryTracked: false,
      defaultStrategy: 'FIFO' as const,
    },
    {
      code: 'TEE-NAVY-M',
      description: 'Cotton t-shirt navy, size M',
      baseUom: 'EA',
      uomLevels: [{ code: 'CS', factor: 20 }],
      lotTracked: false,
      expiryTracked: false,
      defaultStrategy: 'FIFO' as const,
    },
  ];
  const result: Record<string, SkuDto> = {};
  for (const spec of specs) result[spec.code] = await insertSku(db, orgId, spec);
  return result;
}

export async function seedDemoData(db: Db, logger: Logger): Promise<void> {
  const owner = DEMO_USERS[0];
  if (await authRepo.findUserByEmail(db, owner.email)) {
    logger.info('demo data already present, skipping seed');
    return;
  }
  const env = loadEnv({
    ...process.env,
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'x'.repeat(32),
  });
  const ctx: AppContext = { env, db, throttle: createAuthThrottle(env) };

  const orgId = await authRepo.insertOrganization(db, 'Northwind Fulfilment');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = [];
  for (const user of DEMO_USERS) {
    users.push(await authRepo.insertUser(db, { organizationId: orgId, passwordHash, ...user }));
  }
  const ownerUser = users[0] as authRepo.UserRow;
  const auth: AuthContext = {
    sessionId: 'seed',
    csrfToken: 'seed',
    userId: ownerUser.id,
    organizationId: orgId,
    organizationName: 'Northwind Fulfilment',
    email: ownerUser.email,
    name: ownerUser.name,
    role: 'owner',
  };

  const warehouse = await topology.insertWarehouse(db, orgId, {
    code: 'LDN1',
    name: 'London DC 1',
    timezone: 'Europe/London',
  });
  await topology.insertWarehouse(db, orgId, {
    code: 'MAN1',
    name: 'Manchester DC 1',
    timezone: 'Europe/London',
  });
  const bins: Record<string, string> = {};
  for (const zoneSpec of ZONES) {
    const zone = await topology.insertZone(db, orgId, warehouse.id, {
      code: zoneSpec.code,
      name: zoneSpec.name,
      zoneType: zoneSpec.type,
    });
    for (const code of zoneSpec.bins) {
      const address = parseBinCode(code);
      const bin = await topology.insertBin(db, orgId, warehouse.id, {
        zoneId: zone.id,
        code: address.code,
        pickSequence: defaultPickSequence(address),
        maxWeightGrams: 1_000_000,
        maxVolumeCm3: 2_000_000,
      });
      bins[bin.code] = bin.id;
    }
  }

  const skus = await createSkus(db, orgId);
  const today = todayIn(warehouse.timezone);
  const receipt = async (
    sku: string,
    bin: string,
    quantity: number,
    uom: string,
    lotCode?: string,
    expiryInDays?: number,
  ) =>
    receiveStock(
      ctx,
      auth,
      {
        warehouseId: warehouse.id,
        binId: bins[bin] as string,
        skuId: (skus[sku] as SkuDto).id,
        quantity,
        uom,
        ...(lotCode ? { lotCode } : {}),
        ...(expiryInDays !== undefined ? { expiryDate: addDays(today, expiryInDays) } : {}),
        reference: 'SEED',
      },
      'seed',
    );

  await receipt('MILK-UHT-1L', 'A-01-01-1-A', 1, 'PL', 'M2409A', 20);
  await receipt('MILK-UHT-1L', 'A-01-02-1-A', 20, 'CS', 'M2410B', 45);
  await receipt('MILK-UHT-1L', 'A-02-01-1-A', 1, 'PL', 'M2411C', 90);
  await receipt('MILK-UHT-1L', 'P-01-01-0-A', 4, 'CS', 'M2408Z', 6);
  await receipt('VIT-D3-60', 'A-02-03-1-A', 2, 'CS', 'VD-7781', 400);
  await receipt('VIT-D3-60', 'P-01-02-0-A', 10, 'IP', 'VD-7702', 120);
  await receipt('BATT-AA-4', 'A-03-01-1-A', 10, 'CS', 'BT-0425');
  await receipt('BATT-AA-4', 'A-03-02-1-A', 6, 'CS', 'BT-0611');
  const tee = await receipt('TEE-NAVY-M', 'RCV01', 8, 'CS');
  await receipt('MILK-UHT-1L', 'QCAGE1', 2, 'CS', 'M2405Q', 3);

  await moveStock(
    ctx,
    auth,
    {
      warehouseId: warehouse.id,
      fromBinId: bins.RCV01 as string,
      toBinId: bins['A-03-03-1-A'] as string,
      skuId: (skus['TEE-NAVY-M'] as SkuDto).id,
      lotId: tee.lot.id,
      quantity: 6,
      uom: 'CS',
      reference: 'PUTAWAY-SEED',
    },
    'seed',
  );

  await allocateOrder(
    ctx,
    auth,
    {
      warehouseId: warehouse.id,
      orderRef: 'SO-100045',
      shipComplete: false,
      minShelfLifeDays: 7,
      lines: [
        { skuId: (skus['MILK-UHT-1L'] as SkuDto).id, quantity: 6, uom: 'CS' },
        { skuId: (skus['BATT-AA-4'] as SkuDto).id, quantity: 30 },
      ],
    },
    'seed',
  );

  logger.info(
    { organization: 'Northwind Fulfilment', users: DEMO_USERS.length },
    'demo data seeded',
  );
}
