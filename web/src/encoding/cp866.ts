const FALLBACK_UNKNOWN_BYTE = 0x20;

let decoder: TextDecoder | null = null;
try {
  decoder = new TextDecoder('ibm866');
} catch {
  decoder = null;
}

const encoderMap = new Map<string, number>();
let encoderMapReady = false;

function decodeCp866ByteFallback(byte: number): string {
  if (byte >= 0x20 && byte <= 0x7e) {
    return String.fromCharCode(byte);
  }

  if (byte >= 0x80 && byte <= 0x9f) {
    return String.fromCharCode(0x0410 + (byte - 0x80));
  }

  if (byte >= 0xa0 && byte <= 0xaf) {
    return String.fromCharCode(0x0430 + (byte - 0xa0));
  }

  if (byte >= 0xe0 && byte <= 0xef) {
    return String.fromCharCode(0x0440 + (byte - 0xe0));
  }

  if (byte === 0xf0) {
    return '\u0401';
  }

  if (byte === 0xf1) {
    return '\u0451';
  }

  // Remaining CP866 box drawing/control area fallback.
  return ' ';
}

function decodeCp866Byte(byte: number): string {
  if (decoder) {
    return decoder.decode(Uint8Array.of(byte));
  }

  return decodeCp866ByteFallback(byte);
}

function ensureEncoderMap(): void {
  if (encoderMapReady) {
    return;
  }

  for (let byte = 0; byte <= 0xff; byte += 1) {
    const char = decodeCp866Byte(byte);

    // Keep the first mapping to make encoding deterministic.
    if (!encoderMap.has(char)) {
      encoderMap.set(char, byte);
    }
  }

  encoderMapReady = true;
}

export function decodeCp866(bytes: Uint8Array): string {
  if (decoder) {
    return decoder.decode(bytes);
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += decodeCp866ByteFallback(bytes[i]);
  }
  return out;
}

export function encodeCp866(input: string): Uint8Array {
  ensureEncoderMap();

  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    out[i] = encoderMap.get(char) ?? FALLBACK_UNKNOWN_BYTE;
  }

  return out;
}

export function cp866Length(input: string): number {
  return encodeCp866(input).length;
}

export function canEncodeCp866(input: string): boolean {
  ensureEncoderMap();

  for (let i = 0; i < input.length; i += 1) {
    if (!encoderMap.has(input[i])) {
      return false;
    }
  }

  return true;
}
