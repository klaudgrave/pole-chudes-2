import { cp866Length, decodeCp866, encodeCp866 } from '../encoding/cp866.ts';
import { bytesEqual, bytesToHex, hexToBytes } from './bytes.ts';

const RECORD_SIZE = 21;
const MAX_STRING_LENGTH = 20;

export interface OvlQuestion {
  word: string;
  theme: string;
}

export interface OvlFile {
  headerValue: number;
  questions: OvlQuestion[];
}

function decodeRecord(record: Uint8Array, encrypted: boolean): string {
  const len = Math.min(record[0], MAX_STRING_LENGTH);
  const payload = record.slice(1, 1 + len);

  if (encrypted) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = (payload[i] - 32) & 0xff;
    }
  }

  return decodeCp866(payload);
}

function encodeRecord(text: string, encrypted: boolean): Uint8Array {
  if (cp866Length(text) > MAX_STRING_LENGTH) {
    throw new Error(`String is too long for OVL format (${MAX_STRING_LENGTH} bytes max): ${text}`);
  }

  const encoded = encodeCp866(text);
  const record = new Uint8Array(RECORD_SIZE);
  record[0] = encoded.length;

  for (let i = 0; i < encoded.length; i += 1) {
    record[1 + i] = encrypted ? (encoded[i] + 32) & 0xff : encoded[i];
  }

  return record;
}

export function parseOvl(input: Uint8Array | ArrayBuffer): OvlFile {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (data.length % RECORD_SIZE !== 0) {
    throw new Error(`Invalid OVL size ${data.length}: not divisible by ${RECORD_SIZE}`);
  }

  const recordCount = data.length / RECORD_SIZE;
  if (recordCount < 3) {
    throw new Error('OVL has too few records');
  }

  const headerRecord = data.subarray(0, RECORD_SIZE);
  const headerText = decodeRecord(headerRecord, false);
  const headerValue = Number.parseInt(headerText, 10);

  const strings: string[] = [];
  for (let i = 1; i < recordCount; i += 1) {
    const offset = i * RECORD_SIZE;
    const record = data.subarray(offset, offset + RECORD_SIZE);
    strings.push(decodeRecord(record, true));
  }

  const questions: OvlQuestion[] = [];
  for (let i = 0; i < strings.length; i += 2) {
    const word = strings[i] ?? '';
    const theme = strings[i + 1] ?? '';
    questions.push({ word, theme });
  }

  return {
    headerValue: Number.isNaN(headerValue) ? questions.length : headerValue,
    questions,
  };
}

export function serializeOvl(input: OvlFile | OvlQuestion[]): Uint8Array {
  const questions = Array.isArray(input) ? input : input.questions;
  const headerValue = Array.isArray(input) ? questions.length : input.headerValue;

  const records: Uint8Array[] = [];
  records.push(encodeRecord(String(headerValue), false));

  for (const question of questions) {
    records.push(encodeRecord(question.word, true));
    records.push(encodeRecord(question.theme, true));
  }

  const out = new Uint8Array(records.length * RECORD_SIZE);
  for (let i = 0; i < records.length; i += 1) {
    out.set(records[i], i * RECORD_SIZE);
  }

  return out;
}

// --------------------------------------------------------- transcoded format
//
// POLE.OVL expressed as checked-in JSON: the question texts plus, per record,
// the raw garbage bytes the original writer left between the string end and
// the 21-byte record boundary (stale buffer contents — they follow no
// derivable pattern, so they are preserved verbatim to keep the rebuild
// byte-exact). `serializeOvl` above stays the zero-residue writer used for
// session exports from the question editor.

export interface OvlJsonQuestion {
  word: string;
  /** Raw record bytes (hex) after the word string, positions 1+len..20. */
  wordResidue: string;
  theme: string;
  /** Raw record bytes (hex) after the theme string, positions 1+len..20. */
  themeResidue: string;
}

export interface OvlJson {
  format: 'pole-ovl';
  version: 1;
  headerValue: number;
  /** Raw header-record bytes (hex) after the decimal count string. */
  headerResidue: string;
  questions: OvlJsonQuestion[];
}

function assertOvlJson(json: OvlJson): void {
  if (json.format !== 'pole-ovl' || json.version !== 1) {
    throw new Error('Not a pole-ovl v1 JSON asset');
  }
}

function encodeRecordWithResidue(text: string, encrypted: boolean, residueHex: string, where: string): Uint8Array {
  const record = encodeRecord(text, encrypted);
  const residue = hexToBytes(residueHex);
  if (residue.length !== MAX_STRING_LENGTH - record[0]) {
    throw new Error(`${where}: residue is ${residue.length} bytes, expected ${MAX_STRING_LENGTH - record[0]}`);
  }
  record.set(residue, 1 + record[0]);
  return record;
}

/** Rebuilds the exact original POLE.OVL bytes from the transcoded JSON. */
export function rebuildOvl(json: OvlJson): Uint8Array {
  assertOvlJson(json);

  const records: Uint8Array[] = [];
  records.push(encodeRecordWithResidue(String(json.headerValue), false, json.headerResidue, 'header'));

  for (let i = 0; i < json.questions.length; i += 1) {
    const question = json.questions[i];
    records.push(encodeRecordWithResidue(question.word, true, question.wordResidue, `question ${i} word`));
    records.push(encodeRecordWithResidue(question.theme, true, question.themeResidue, `question ${i} theme`));
  }

  const out = new Uint8Array(records.length * RECORD_SIZE);
  for (let i = 0; i < records.length; i += 1) {
    out.set(records[i], i * RECORD_SIZE);
  }
  return out;
}

/** Converts the transcoded JSON into the same structure `parseOvl` returns. */
export function ovlFromJson(json: OvlJson): OvlFile {
  assertOvlJson(json);
  return {
    headerValue: json.headerValue,
    questions: json.questions.map((question) => ({ word: question.word, theme: question.theme })),
  };
}

/**
 * Transcodes the original POLE.OVL bytes to JSON. Throws if the result does
 * not rebuild the input byte-for-byte (which also proves every string
 * survives the CP866 decode/encode round trip).
 */
export function ovlToJson(input: Uint8Array | ArrayBuffer): OvlJson {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parseOvl(data);

  const residueOf = (recordIndex: number): string => {
    const record = data.subarray(recordIndex * RECORD_SIZE, (recordIndex + 1) * RECORD_SIZE);
    return bytesToHex(record.subarray(1 + Math.min(record[0], MAX_STRING_LENGTH)));
  };

  const questions: OvlJsonQuestion[] = parsed.questions.map((question, i) => ({
    word: question.word,
    wordResidue: residueOf(1 + i * 2),
    theme: question.theme,
    themeResidue: residueOf(2 + i * 2),
  }));

  const json: OvlJson = {
    format: 'pole-ovl',
    version: 1,
    headerValue: parsed.headerValue,
    headerResidue: residueOf(0),
    questions,
  };
  if (!bytesEqual(rebuildOvl(json), data)) {
    throw new Error('POLE.OVL transcode failed to round-trip byte-for-byte');
  }
  return json;
}
