import { cp866Length, decodeCp866, encodeCp866 } from '../encoding/cp866.ts';
import { bytesEqual, bytesToHex, hexToBytes } from './bytes.ts';

const RECORD_COUNT = 8;
const RECORD_SIZE = 13;
const MAX_NAME_LENGTH = 10;

export interface TopPlayerRecord {
  name: string;
  score: number;
}

function parseRecord(data: Uint8Array): TopPlayerRecord {
  const len = Math.min(data[0], MAX_NAME_LENGTH);
  const name = decodeCp866(data.slice(1, 1 + len));
  const score = data[11] | (data[12] << 8);

  return { name, score };
}

function serializeRecord(record: TopPlayerRecord): Uint8Array {
  if (cp866Length(record.name) > MAX_NAME_LENGTH) {
    throw new Error(`Name is too long for PIC format (${MAX_NAME_LENGTH} bytes max): ${record.name}`);
  }

  const out = new Uint8Array(RECORD_SIZE);
  const encoded = encodeCp866(record.name);
  out[0] = encoded.length;
  out.set(encoded, 1);

  const clampedScore = Math.max(0, Math.min(0xffff, Math.floor(record.score)));
  out[11] = clampedScore & 0xff;
  out[12] = (clampedScore >> 8) & 0xff;

  return out;
}

export function parsePic(input: Uint8Array | ArrayBuffer): TopPlayerRecord[] {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (data.length !== RECORD_COUNT * RECORD_SIZE) {
    throw new Error(`Unexpected PIC size ${data.length}`);
  }

  const out: TopPlayerRecord[] = [];
  for (let i = 0; i < RECORD_COUNT; i += 1) {
    const offset = i * RECORD_SIZE;
    out.push(parseRecord(data.slice(offset, offset + RECORD_SIZE)));
  }

  return out;
}

export function serializePic(records: TopPlayerRecord[]): Uint8Array {
  const limited = records.slice(0, RECORD_COUNT);

  while (limited.length < RECORD_COUNT) {
    limited.push({ name: '', score: 0 });
  }

  const out = new Uint8Array(RECORD_COUNT * RECORD_SIZE);

  for (let i = 0; i < RECORD_COUNT; i += 1) {
    out.set(serializeRecord(limited[i]), i * RECORD_SIZE);
  }

  return out;
}

// --------------------------------------------------------- transcoded format
//
// POLE.PIC expressed as checked-in JSON: the top-8 names and scores plus, per
// record, the raw garbage bytes between the name end and the score field
// (stale buffer contents from the original writer — e.g. record 0 still shows
// the "...ЬЕВ" tail of an older, longer name). Preserved verbatim to keep the
// rebuild byte-exact.

export interface PicJsonPlayer {
  name: string;
  score: number;
  /** Raw record bytes (hex) after the name string, positions 1+len..10. */
  residue: string;
}

export interface PicJson {
  format: 'pole-pic';
  version: 1;
  players: PicJsonPlayer[];
}

function assertPicJson(json: PicJson): void {
  if (json.format !== 'pole-pic' || json.version !== 1) {
    throw new Error('Not a pole-pic v1 JSON asset');
  }
  if (json.players.length !== RECORD_COUNT) {
    throw new Error(`Expected ${RECORD_COUNT} top players, got ${json.players.length}`);
  }
}

/** Rebuilds the exact original POLE.PIC bytes from the transcoded JSON. */
export function rebuildPic(json: PicJson): Uint8Array {
  assertPicJson(json);

  const out = new Uint8Array(RECORD_COUNT * RECORD_SIZE);
  for (let i = 0; i < RECORD_COUNT; i += 1) {
    const player = json.players[i];
    const record = serializeRecord({ name: player.name, score: player.score });
    const residue = hexToBytes(player.residue);
    if (residue.length !== MAX_NAME_LENGTH - record[0]) {
      throw new Error(`Player ${i}: residue is ${residue.length} bytes, expected ${MAX_NAME_LENGTH - record[0]}`);
    }
    record.set(residue, 1 + record[0]);
    out.set(record, i * RECORD_SIZE);
  }
  return out;
}

/** Converts the transcoded JSON into the same structure `parsePic` returns. */
export function picFromJson(json: PicJson): TopPlayerRecord[] {
  assertPicJson(json);
  return json.players.map((player) => ({ name: player.name, score: player.score }));
}

/**
 * Transcodes the original POLE.PIC bytes to JSON. Throws if the result does
 * not rebuild the input byte-for-byte.
 */
export function picToJson(input: Uint8Array | ArrayBuffer): PicJson {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parsePic(data);

  const players: PicJsonPlayer[] = parsed.map((player, i) => {
    const record = data.subarray(i * RECORD_SIZE, (i + 1) * RECORD_SIZE);
    const len = Math.min(record[0], MAX_NAME_LENGTH);
    return {
      name: player.name,
      score: player.score,
      residue: bytesToHex(record.subarray(1 + len, 11)),
    };
  });

  const json: PicJson = { format: 'pole-pic', version: 1, players };
  if (!bytesEqual(rebuildPic(json), data)) {
    throw new Error('POLE.PIC transcode failed to round-trip byte-for-byte');
  }
  return json;
}
