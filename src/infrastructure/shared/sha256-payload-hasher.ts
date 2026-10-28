import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { PayloadHasher } from '../../application/shared/payload-hasher.port';

@Injectable()
export class Sha256PayloadHasher implements PayloadHasher {
  hash(payload: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(canonicalJson(payload)).digest('hex');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers');
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const serializedEntries = entries.map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
    );

    return `{${serializedEntries.join(',')}}`;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}
