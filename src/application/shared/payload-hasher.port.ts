export const PAYLOAD_HASHER = Symbol('PAYLOAD_HASHER');

export interface PayloadHasher {
  hash(payload: Readonly<Record<string, unknown>>): string;
}
