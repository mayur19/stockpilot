import { describe, expect, it } from 'vitest';
import { defaultPickSequence, DomainError, parseBinCode } from '../src/index.js';

describe('parseBinCode', () => {
  it('parses structured codes and normalises case', () => {
    expect(parseBinCode(' a-03-12-2-b ')).toEqual({
      code: 'A-03-12-2-B',
      zone: 'A',
      structured: true,
      aisle: 3,
      rack: 12,
      level: 2,
      position: 'B',
    });
  });

  it('accepts free-form staging codes', () => {
    expect(parseBinCode('dock1')).toEqual({ code: 'DOCK1', zone: 'DOCK1', structured: false });
  });

  it.each(['A-00-01-1-A', 'A-01-00-1-A', 'A-1-01-1-A', '1A', 'A', 'A-01-01-1-1', ''])(
    'rejects %s',
    (code) => {
      expect(() => parseBinCode(code)).toThrow(DomainError);
    },
  );
});

describe('defaultPickSequence', () => {
  it('walks odd aisles ascending and even aisles descending (serpentine)', () => {
    const seq = (code: string) => defaultPickSequence(parseBinCode(code));
    expect(seq('A-01-01-0-A')).toBeLessThan(seq('A-01-02-0-A'));
    expect(seq('A-02-02-0-A')).toBeLessThan(seq('A-02-01-0-A'));
    expect(seq('A-01-99-0-A')).toBeLessThan(seq('A-02-99-0-A'));
    expect(seq('A-01-01-1-A')).toBeLessThan(seq('A-01-01-1-B'));
    expect(seq('STAGE')).toBe(0);
  });
});
