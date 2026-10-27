/**
 * The backup FILE: how it is packed, protected and read back.
 *
 * Nothing in here knows about databases. It turns a stream of text lines into
 * one file, and one file back into a stream of text lines. Only Web APIs are
 * used (CompressionStream, SubtleCrypto, TextEncoder), so the very same code
 * runs in the admin's browser, in the command-line scripts (Node) and in the
 * tests. It runs on the admin's own computer on purpose: compressing and
 * encrypting a real database is more CPU than an Edge Function is allowed, and
 * it means the passphrase never leaves the admin's machine.
 *
 *   file    = header line (JSON, plain text) + "\n" + payload
 *   payload = gzip( lines separated by "\n" )                       not encrypted
 *           = frames( gzip( lines separated by "\n" ) )             encrypted
 *   frame   = 4 bytes big-endian length of what follows
 *             + 12 bytes IV + AES-256-GCM ciphertext and tag
 *
 * WHY ENCRYPT AT ALL. A backup holds everything the database holds: every
 * creator's contact details, every password hash, the TikTok connection
 * details. The file is meant to be downloaded and kept somewhere else, which is
 * exactly when it is most likely to be lost, emailed or synced to the wrong
 * cloud folder. A passphrase makes a lost file worthless. The cost is that a
 * forgotten passphrase cannot be recovered by anybody, which the screen says
 * before it lets anyone choose one.
 *
 * WHY THE HEADER IS PLAIN TEXT. So a file can be recognised, and so the screen
 * can say "this one needs a passphrase" before asking for anything. It holds
 * nothing secret: the key-derivation settings and an encrypted known phrase
 * used to tell a wrong passphrase from a damaged file.
 */

export class BackupError extends Error {
  readonly code:
    | 'not_a_backup'
    | 'unsupported_version'
    | 'needs_passphrase'
    | 'wrong_passphrase'
    | 'corrupt';
  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface BackupHeader {
  format: 'prism-backup';
  v: 1;
  created_at: string;
  encrypted: boolean;
  kdf?: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  verify?: { iv: string; ct: string };
}

/** 600k is the current OWASP figure for PBKDF2-HMAC-SHA256. */
const KDF_ITERATIONS = 600_000;
const FRAME_BYTES = 1024 * 1024;
const VERIFY_PHRASE = 'prism-backup-ok';
const enc = new TextEncoder();

// ------------------------------------------------------------------ helpers --

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(key: CryptoKey, plain: Uint8Array): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource),
  );
  return { iv, ct };
}

// ------------------------------------------------------------------- writer --

/** Collects lines into one finished backup file. Memory holds the COMPRESSED bytes only. */
export class BackupWriter {
  private readonly gz = new CompressionStream('gzip');
  // The DOM and Deno typings disagree about the element type; the bytes are the same.
  // deno-lint-ignore no-explicit-any
  private readonly gzWriter: WritableStreamDefaultWriter<any>;
  private readonly chunks: Uint8Array[] = [];
  private readonly pump: Promise<void>;
  private finished = false;

  private readonly header: BackupHeader;
  private readonly key: CryptoKey | null;

  private constructor(header: BackupHeader, key: CryptoKey | null) {
    this.header = header;
    this.key = key;
    this.gzWriter = this.gz.writable.getWriter();
    const reader = this.gz.readable.getReader();
    this.pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.chunks.push(value);
      }
    })();
  }

  static async create(opts: { passphrase?: string | null } = {}): Promise<BackupWriter> {
    const header: BackupHeader = {
      format: 'prism-backup',
      v: 1,
      created_at: new Date().toISOString(),
      encrypted: false,
    };
    let key: CryptoKey | null = null;
    if (opts.passphrase) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(opts.passphrase, salt, KDF_ITERATIONS);
      const v = await seal(key, enc.encode(VERIFY_PHRASE));
      header.encrypted = true;
      header.kdf = { name: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: toBase64(salt) };
      header.verify = { iv: toBase64(v.iv), ct: toBase64(v.ct) };
    }
    return new BackupWriter(header, key);
  }

  async writeLine(line: string): Promise<void> {
    if (this.finished) throw new Error('backup already finished');
    await this.gzWriter.write(enc.encode(line + '\n'));
  }

  /** Close the stream and return the complete file. */
  async finish(): Promise<Uint8Array> {
    this.finished = true;
    await this.gzWriter.close();
    await this.pump;
    const gzBytes = concat(this.chunks);
    this.chunks.length = 0;

    let payload: Uint8Array;
    if (this.key) {
      const frames: Uint8Array[] = [];
      for (let at = 0; at < gzBytes.length; at += FRAME_BYTES) {
        const { iv, ct } = await seal(this.key, gzBytes.subarray(at, at + FRAME_BYTES));
        const len = new Uint8Array(4);
        new DataView(len.buffer).setUint32(0, iv.length + ct.length);
        frames.push(len, iv, ct);
      }
      payload = concat(frames);
    } else {
      payload = gzBytes;
    }
    return concat([enc.encode(JSON.stringify(this.header) + '\n'), payload]);
  }
}

// ------------------------------------------------------------------- reader --

/** Read only the plain-text first line: is this a Prism backup, and is it locked? No passphrase needed. */
export function peekHeader(bytes: Uint8Array): BackupHeader | null {
  const nl = bytes.indexOf(10);
  if (nl < 1 || nl > 4096) return null;
  try {
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(0, nl))) as BackupHeader;
    return h?.format === 'prism-backup' ? h : null;
  } catch {
    return null;
  }
}

export interface OpenedBackup {
  header: BackupHeader;
  /** A fresh pass over every line. Call it again for a second pass. */
  lines(): AsyncGenerator<string>;
}

export async function openBackup(
  bytes: Uint8Array,
  passphrase?: string | null,
): Promise<OpenedBackup> {
  const nl = bytes.indexOf(10);
  if (nl < 1 || nl > 4096) {
    throw new BackupError('not_a_backup', 'This is not a Prism backup file.');
  }
  let header: BackupHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(0, nl)));
  } catch {
    throw new BackupError('not_a_backup', 'This is not a Prism backup file.');
  }
  if (header?.format !== 'prism-backup') {
    throw new BackupError('not_a_backup', 'This is not a Prism backup file.');
  }
  if (header.v !== 1) {
    throw new BackupError(
      'unsupported_version',
      'This backup was made by a newer version of Prism and cannot be read here.',
    );
  }

  let key: CryptoKey | null = null;
  if (header.encrypted) {
    if (!passphrase) {
      throw new BackupError('needs_passphrase', 'This backup is protected by a passphrase.');
    }
    if (!header.kdf || !header.verify) {
      throw new BackupError('corrupt', 'The protection details in this backup are damaged.');
    }
    key = await deriveKey(passphrase, fromBase64(header.kdf.salt), header.kdf.iterations);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(header.verify.iv) as BufferSource },
        key,
        fromBase64(header.verify.ct) as BufferSource,
      );
      if (new TextDecoder().decode(plain) !== VERIFY_PHRASE) throw new Error('mismatch');
    } catch {
      throw new BackupError('wrong_passphrase', 'That passphrase is not right.');
    }
  }

  const payload = bytes.subarray(nl + 1);

  async function* gzipBytes(): AsyncGenerator<Uint8Array> {
    if (!key) {
      yield payload;
      return;
    }
    let at = 0;
    while (at < payload.length) {
      if (at + 4 > payload.length) throw new BackupError('corrupt', 'The backup file is cut short.');
      const len = new DataView(payload.buffer, payload.byteOffset + at, 4).getUint32(0);
      at += 4;
      if (at + len > payload.length) throw new BackupError('corrupt', 'The backup file is cut short.');
      const iv = payload.subarray(at, at + 12);
      const ct = payload.subarray(at + 12, at + len);
      at += len;
      try {
        yield new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            ct as BufferSource,
          ),
        );
      } catch {
        throw new BackupError('corrupt', 'The backup file is damaged (a block failed its check).');
      }
    }
  }

  async function* lines(): AsyncGenerator<string> {
    const source = gzipBytes();
    const raw = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await source.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (e) {
          controller.error(e);
        }
      },
    });
    // deno-lint-ignore no-explicit-any
    const reader = raw.pipeThrough(new DecompressionStream('gzip') as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let tail = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tail += decoder.decode(value, { stream: true });
        let at: number;
        while ((at = tail.indexOf('\n')) >= 0) {
          const line = tail.slice(0, at);
          tail = tail.slice(at + 1);
          if (line) yield line;
        }
      }
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError('corrupt', 'The backup file is damaged or incomplete.');
    }
    tail += decoder.decode();
    if (tail) yield tail;
  }

  return { header, lines };
}
