import type { AllocationStrategy, Role, UomLevel, ZoneType } from '@stockpilot/shared';

export interface CurrentUser {
  user: { id: string; email: string; name: string; role: Role };
  organization: { id: string; name: string };
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export interface Bin {
  id: string;
  code: string;
  zoneId: string;
  zoneCode: string;
  pickSequence: number;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  zoneType: ZoneType;
}

export interface Sku {
  id: string;
  code: string;
  description: string;
  baseUom: string;
  uomLevels: UomLevel[];
  lotTracked: boolean;
  expiryTracked: boolean;
  defaultStrategy: AllocationStrategy;
}

export interface StockBalance {
  binId: string;
  binCode: string;
  zoneCode: string;
  skuId: string;
  skuCode: string;
  skuDescription: string;
  baseUom: string;
  lotId: string;
  lotCode: string;
  expiryDate: string | null;
  onHand: number;
  allocated: number;
  available: number;
}

export interface AllocationSummary {
  id: string;
  orderRef: string;
  status: 'ALLOCATED' | 'PARTIAL' | 'RELEASED';
  shipComplete: boolean;
  createdAt: string;
}

export interface AllocationDetail extends AllocationSummary {
  lines: {
    lineNo: number;
    skuCode: string;
    strategy: AllocationStrategy;
    requested: number;
    allocated: number;
    picks: { binCode: string; lotCode: string; expiryDate: string | null; quantity: number }[];
  }[];
}
