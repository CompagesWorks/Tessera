export interface AccessUnit {
  data: Uint8Array;
  key: boolean;
}

export interface H264Stream {
  codec: string | null;
  units: AccessUnit[];
}

const START = new Uint8Array([0, 0, 0, 1]);
const VCL = new Set([1, 5]);
const PREFIX = new Set([6, 7, 8, 9]);

function nalUnits(bytes: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    if (start >= 0) units.push(bytes.subarray(start, i > 0 && bytes[i - 1] === 0 ? i - 1 : i));
    start = i + 3;
    i += 2;
  }
  if (start >= 0 && start < bytes.length) units.push(bytes.subarray(start));
  return units.filter((unit) => unit.length > 0);
}

const hex = (value: number) => value.toString(16).padStart(2, '0');

export function parseH264(bytes: Uint8Array): H264Stream {
  let codec: string | null = null;
  const units: AccessUnit[] = [];
  let current: Uint8Array[] = [];
  let hasSlice = false;
  let key = false;
  const flush = () => {
    if (hasSlice) {
      const size = current.reduce((sum, nal) => sum + START.length + nal.length, 0);
      const data = new Uint8Array(size);
      let offset = 0;
      for (const nal of current) {
        data.set(START, offset);
        data.set(nal, offset + START.length);
        offset += START.length + nal.length;
      }
      units.push({ data, key });
    }
    current = [];
    hasSlice = false;
    key = false;
  };
  for (const nal of nalUnits(bytes)) {
    const type = nal[0]! & 0x1f;
    const firstSlice = VCL.has(type) && nal.length > 1 && (nal[1]! & 0x80) !== 0;
    if (hasSlice && (PREFIX.has(type) || firstSlice)) flush();
    if (type === 7 && nal.length > 3 && codec === null) codec = `avc1.${hex(nal[1]!)}${hex(nal[2]!)}${hex(nal[3]!)}`;
    if (type === 9) continue;
    current.push(nal);
    if (VCL.has(type)) hasSlice = true;
    if (type === 5) key = true;
  }
  flush();
  const firstKey = units.findIndex((unit) => unit.key);
  return { codec, units: firstKey < 0 ? [] : units.slice(firstKey) };
}
