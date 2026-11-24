import type { Sku } from '../../api/types';

export function UomSelect({
  sku,
  value,
  onChange,
}: {
  sku: Sku | undefined;
  value: string;
  onChange: (uom: string) => void;
}) {
  const options = sku ? [sku.baseUom, ...sku.uomLevels.map((l) => l.code)] : [];
  return (
    <label>
      Unit
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!sku}>
        {options.map((code) => {
          const level = sku?.uomLevels.find((l) => l.code === code);
          return (
            <option key={code} value={code}>
              {code}
              {level ? ` (${level.factor} ${sku?.baseUom})` : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}
