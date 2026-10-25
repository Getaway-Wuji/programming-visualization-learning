// Task 11.4 production-build HTTPS harness. This does not install certificates,
// change OS networking, or replace a public deployment's certificate validation.
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer as createTcpServer } from 'node:net';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearImmediate, setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.cur': 'image/x-icon',
};

function writeNew(path, value) {
  writeFileSync(path, value, { flag: 'wx' });
}

function resourcesFrom(root) {
  const resources = new Map();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const actual = realpathSync(path);
        if (!actual.startsWith(root + sep)) throw new Error('Resource escaped production root');
        const raw = readFileSync(actual);
        const compressible = /\.(?:html|js|css|wasm|json|svg)$/.test(path);
        const variants = { identity: raw };
        if (compressible) {
          variants.gzip = gzipSync(raw, { level: 9 });
          variants.br = brotliCompressSync(raw, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
          });
        }
        const pathname = '/' + relative(root, path).split(sep).join('/');
        resources.set(pathname, {
          rawBytes: raw.length,
          mime: mime[extname(path)] ?? 'application/octet-stream',
          modified: statSync(path).mtime.toUTCString(),
          variants,
          etags: Object.fromEntries(
            Object.entries(variants).map(([encoding, bytes]) => [encoding, `"${sha256(bytes)}"`]),
          ),
        });
      }
    }
  }
  walk(root);
  return resources;
}

function acceptedEncoding(value, resource) {
  const choices = String(value ?? '')
    .split(',')
    .map((part) => {
      const [name, ...parameters] = part.trim().split(';');
      const q = parameters.find((parameter) => parameter.trim().startsWith('q='));
      return { name, q: q ? Number(q.trim().slice(2)) : 1 };
    });
  const quality = (name) => choices.find((item) => item.name === name)?.q ?? 0;
  if (resource.variants.br && quality('br') > 0 && quality('br') >= quality('gzip')) return 'br';
  if (resource.variants.gzip && quality('gzip') > 0) return 'gzip';
  return 'identity';
}

// Windows' ordinary timers can wake 15 ms late. Poll only the final <=18 ms
// using setImmediate so no global clock-resolution or power setting is changed.
// This harness may use one server CPU core while a paced transfer is pending;
// CPU use is disclosed in the summary, outside the browser/Worker processes.
function callAt(due, callback) {
  let cancelled = false;
  let handle = null;
  let kind = null;
  function tick() {
    if (cancelled) return;
    const remaining = due - performance.now();
    if (remaining <= 0) callback();
    else if (remaining > 18) {
      kind = 'timeout';
      handle = setTimeout(tick, remaining - 16);
    } else {
      kind = 'immediate';
      handle = setImmediate(tick);
    }
  }
  // Never invoke the callback before returning its cancellation handle. A due
  // deadline can be crossed between SharedWire.flush and schedule; synchronous
  // re-entry there would leave a completed handle in this.timer forever and
  // stall every later connection sharing that direction.
  kind = 'immediate';
  handle = setImmediate(tick);
  return () => {
    cancelled = true;
    if (kind === 'timeout') clearTimeout(handle);
    else clearImmediate(handle);
  };
}

// One scheduler per direction, shared by every connection (including Workers).
// Serialization is computed from TLS bytes, so headers and handshake bytes count.
// Every piece receives 20 ms propagation after serialization. A single global
// virtual wire cursor prevents parallel resource connections multiplying 20 Mbps.
class SharedWire {
  constructor(bitsPerSecond, propagationMs) {
    this.bytesPerMs = bitsPerSecond / 8 / 1000;
    this.propagationMs = propagationMs;
    this.cursor = 0;
    this.queue = [];
    this.timer = null;
    this.bytes = 0;
    this.pieces = 0;
    this.maxLateMs = 0;
    this.queuedBytes = 0;
    this.maximumQueuedBytes = 0;
    this.waiters = [];
    this.closed = false;
  }

  send(bytes, destination) {
    if (this.closed || destination.destroyed) return Promise.resolve();
    return new Promise((resolveSend) => {
      let offset = 0;
      while (offset < bytes.length) {
        const end = Math.min(offset + 4096, bytes.length);
        const piece = bytes.subarray(offset, end);
        this.cursor = Math.max(this.cursor, performance.now()) + piece.length / this.bytesPerMs;
        this.queue.push({
          due: this.cursor + this.propagationMs,
          piece,
          destination,
          resolveSend: end === bytes.length ? resolveSend : null,
        });
        this.queuedBytes += piece.length;
        this.maximumQueuedBytes = Math.max(this.maximumQueuedBytes, this.queuedBytes);
        offset = end;
      }
      if (bytes.length === 0) resolveSend();
      this.schedule();
    });
  }

  schedule() {
    if (this.timer || !this.queue.length || this.closed) return;
    this.timer = callAt(this.queue[0].due, () => this.flush());
  }

  flush() {
    this.timer = null;
    while (this.queue.length && this.queue[0].due <= performance.now()) {
      const item = this.queue.shift();
      this.queuedBytes -= item.piece.length;
      this.maxLateMs = Math.max(this.maxLateMs, performance.now() - item.due);
      if (!item.destination.destroyed) {
        item.destination.write(item.piece);
        this.bytes += item.piece.length;
        this.pieces++;
      }
      item.resolveSend?.();
    }
    this.waiters = this.waiters.filter((waiter) => {
      if (this.queuedBytes > waiter.threshold) return true;
      waiter.resolve();
      return false;
    });
    this.schedule();
  }

  stop() {
    this.closed = true;
    this.timer?.();
    for (const item of this.queue) item.resolveSend?.();
    this.queue = [];
    this.queuedBytes = 0;
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters = [];
  }

  summary() {
    return {
      bytes: this.bytes,
      pieces: this.pieces,
      maximumSchedulerLatenessMs: this.maxLateMs,
      maximumQueuedBytes: this.maximumQueuedBytes,
      queuedBytes: this.queuedBytes,
      pendingPieces: this.queue.length,
      timerScheduled: this.timer !== null,
      firstPendingDeadlineFromNowMs: this.queue.length
        ? this.queue[0].due - performance.now()
        : null,
    };
  }

  waitBelow(threshold) {
    if (this.queuedBytes <= threshold || this.closed) return Promise.resolve();
    return new Promise((resolveWaiter) => this.waiters.push({ threshold, resolve: resolveWaiter }));
  }
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
}

export async function startPerformanceServer(options = {}) {
  const port = Number(options.port ?? 4190);
  const internalPort = Number(options.internalPort ?? 4191);
  if (!Number.isInteger(port) || !Number.isInteger(internalPort) || port === internalPort)
    throw new Error('Distinct integer performance and internal ports are required');
  const root = realpathSync(join(workspace, 'web/dist'));
  const pfxPath = resolve(workspace, options.pfx ?? '.artifacts/11.4/conditions-local-tls.pfx');
  const certificatePath = resolve(
    workspace,
    options.certificate ?? '.artifacts/11.4/conditions-local-tls.cer',
  );
  const logPrefix = resolve(
    workspace,
    options.logPrefix ?? `.artifacts/11.4/network-${Date.now()}`,
  );
  if (!logPrefix.startsWith(resolve(workspace, '.artifacts/11.4') + sep))
    throw new Error('Performance evidence must stay inside .artifacts/11.4');
  if (existsSync(logPrefix + '-server.json') || existsSync(logPrefix + '-requests.jsonl'))
    throw new Error('Refusing to overwrite existing performance server evidence');
  const styleHashes = JSON.parse(
    readFileSync(join(workspace, '.artifacts/block-style-hashes.json')),
  );
  if (styleHashes.version !== '13.4.0' || styleHashes.hashes.length !== 2)
    throw new Error('Build reviewed Blockly styles before serving performance measurements');
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self' ${styleHashes.hashes.map((hash) => `'sha256-${hash}'`).join(' ')}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
  const resources = resourcesFrom(root);
  const certificate = new X509Certificate(readFileSync(certificatePath));
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const requests = [];
  const connections = [];
  const sockets = new Set();
  const uplink = new SharedWire(5_000_000, 20);
  const downlink = new SharedWire(20_000_000, 20);
  let requestSequence = 0;
  let connectionSequence = 0;
  let stopping = null;
  const origin = `https://127.0.0.1:${port}`;
  const metadata = {
    task: '11.4',
    harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    startedAt: new Date().toISOString(),
    node: process.version,
    origin,
    internalOrigin: `https://127.0.0.1:${internalPort}`,
    root: 'web/dist',
    transport: 'TLS 1.2 or 1.3 over a shared paced loopback TCP forwarder; HTTP/1.1',
    network: {
      downloadBitsPerSecond: 20_000_000,
      uploadBitsPerSecond: 5_000_000,
      oneWayPropagationMs: 20,
      roundTripPropagationMs: 40,
      lossInjected: 0,
      pieceBytes: 4096,
      sharedAcrossAllConnectionsAndWorkers: true,
      initialConnectionSetupCompensationMs: 40,
      timer:
        'Monotonic deadline checks with setImmediate during the last 18 ms; no OS clock-resolution or power settings changed. Pending transfers may consume one server CPU core; server CPU use is reported separately.',
      limitation:
        'User-space pacing cannot delay the OS loopback SYN-ACK. Each connection therefore holds its first TLS traffic for an additional 40 ms to account for one TCP-handshake RTT in end-to-end time. Browser connect subphase timing is not an actual WAN TCP measurement. Timer scheduling and loopback overhead are measured by calibration.',
    },
    certificate: {
      sha256: sha256(certificate.raw),
      publicKeySpkiSha256: createHash('sha256')
        .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('base64'),
      validTo: certificate.validTo,
      trust:
        'Local self-signed test certificate; acceptance must be scoped by the owned test client (Chromium uses the exact SPKI pin, broad context HTTPS suppression remains false). No system trust or public deployment trust claim.',
    },
    compression:
      'Precomputed Brotli quality 11 and gzip level 9; accepted encoding varies response and ETag',
    cache:
      'Hashed /assets immutable for one year; all other public resources no-cache with ETag revalidation',
    resourceManifest: [...resources].map(([path, entry]) => ({
      path,
      rawBytes: entry.rawBytes,
      identitySha256: sha256(entry.variants.identity),
      gzipBytes: entry.variants.gzip?.length ?? null,
      brotliBytes: entry.variants.br?.length ?? null,
    })),
    instrumentation:
      'In-memory static request/connection metadata only, flushed on controlled shutdown; no request or response payload logging',
  };

  const httpsServer = createHttpsServer(
    { pfx: readFileSync(pfxPath), passphrase: '', minVersion: 'TLSv1.2' },
    (request, response) => {
      const at = performance.now();
      let url;
      try {
        url = new URL(request.url ?? '/', origin);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const record = {
        id: ++requestSequence,
        method: request.method,
        path: url.pathname,
        startMs: at - started,
        status: null,
        encoding: null,
        rawBytes: null,
        responseBodyBytes: null,
        conditionalEtag: typeof request.headers['if-none-match'] === 'string',
      };
      requests.push(record);
      response.on('finish', () => {
        record.finishMs = performance.now() - started;
        record.status = response.statusCode;
      });
      response.on('close', () => {
        if (!response.writableFinished) record.abortedMs = performance.now() - started;
      });
      const headers = {
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': csp,
        'Cache-Control': 'no-store',
      };
      if (url.pathname === '/__perf/health') {
        const bytes = Buffer.from(
          JSON.stringify({ origin, network: metadata.network, ready: true }),
        );
        response
          .writeHead(200, {
            ...headers,
            'Content-Type': 'application/json',
            'Content-Length': bytes.length,
          })
          .end(bytes);
        record.rawBytes = record.responseBodyBytes = bytes.length;
        return;
      }
      if (url.pathname === '/__perf/calibration' && request.method === 'GET') {
        const size = Number(url.searchParams.get('bytes') ?? '1');
        if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024) {
          response.writeHead(400, headers).end();
          return;
        }
        const bytes = randomBytes(size);
        record.rawBytes = record.responseBodyBytes = size;
        record.encoding = 'identity';
        response
          .writeHead(200, {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'Content-Length': size,
            'X-Calibration-SHA256': sha256(bytes),
          })
          .end(bytes);
        return;
      }
      if (url.pathname === '/__perf/upload' && request.method === 'POST') {
        let received = 0;
        const digest = createHash('sha256');
        request.on('data', (bytes) => {
          received += bytes.length;
          if (received > 8 * 1024 * 1024) request.destroy();
          else digest.update(bytes);
        });
        request.on('end', () => {
          const bytes = Buffer.from(JSON.stringify({ received, sha256: digest.digest('hex') }));
          record.rawBytes = record.responseBodyBytes = bytes.length;
          response
            .writeHead(200, {
              ...headers,
              'Content-Type': 'application/json',
              'Content-Length': bytes.length,
            })
            .end(bytes);
        });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        response.writeHead(400, headers).end();
        return;
      }
      const resource = resources.get(pathname === '/' ? '/index.html' : pathname);
      if (!resource) {
        response.writeHead(404, headers).end('Resource not found');
        return;
      }
      const encoding = acceptedEncoding(request.headers['accept-encoding'], resource);
      const bytes = resource.variants[encoding];
      const etag = resource.etags[encoding];
      record.encoding = encoding;
      record.rawBytes = resource.rawBytes;
      const resourceHeaders = {
        ...headers,
        'Content-Type': resource.mime,
        'Cache-Control': /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm)$/.test(pathname)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        Vary: 'Accept-Encoding',
        ETag: etag,
        'Last-Modified': resource.modified,
        ...(encoding === 'identity' ? {} : { 'Content-Encoding': encoding }),
      };
      const match = String(request.headers['if-none-match'] ?? '')
        .split(',')
        .map((value) => value.trim());
      if (match.includes(etag) || match.includes('*')) {
        record.responseBodyBytes = 0;
        response.writeHead(304, resourceHeaders).end();
      } else {
        record.responseBodyBytes = request.method === 'HEAD' ? 0 : bytes.length;
        response.writeHead(200, { ...resourceHeaders, 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
      }
    },
  );
  httpsServer.keepAliveTimeout = 30_000;
  httpsServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const proxy = createTcpServer((client) => {
    client.setNoDelay(true);
    client.pause();
    sockets.add(client);
    const record = {
      id: ++connectionSequence,
      startMs: performance.now() - started,
      uploadedTlsBytes: 0,
      downloadedTlsBytes: 0,
    };
    connections.push(record);
    let upstream = null;
    let pendingUpload = Promise.resolve();
    let pendingDownload = Promise.resolve();
    const cancelSetup = callAt(performance.now() + 40, () => {
      if (client.destroyed) return;
      upstream = connect({ host: '127.0.0.1', port: internalPort });
      sockets.add(upstream);
      upstream.setNoDelay(true);
      upstream.on('connect', () => client.resume());
      client.on('data', (bytes) => {
        record.uploadedTlsBytes += bytes.length;
        pendingUpload = uplink.send(bytes, upstream);
        if (uplink.queuedBytes >= 512 * 1024) {
          client.pause();
          void uplink.waitBelow(256 * 1024).then(() => {
            if (!client.destroyed) client.resume();
          });
        }
      });
      upstream.on('data', (bytes) => {
        record.downloadedTlsBytes += bytes.length;
        pendingDownload = downlink.send(bytes, client);
        if (downlink.queuedBytes >= 512 * 1024) {
          upstream.pause();
          void downlink.waitBelow(256 * 1024).then(() => {
            if (!upstream.destroyed) upstream.resume();
          });
        }
      });
      upstream.on('end', () => {
        void pendingDownload.then(() => client.end());
      });
      upstream.on('error', (error) => {
        record.upstreamError = error.code ?? error.message;
        client.destroy();
      });
      upstream.on('close', () => {
        sockets.delete(upstream);
      });
    });
    client.on('error', (error) => {
      record.clientError = error.code ?? error.message;
      upstream?.destroy();
    });
    client.on('end', () => {
      void pendingUpload.then(() => upstream?.end());
    });
    client.on('close', () => {
      cancelSetup();
      record.closeMs = performance.now() - started;
      sockets.delete(client);
      upstream?.destroy();
    });
  });

  const stop = async () => {
    if (stopping) return stopping;
    stopping = (async () => {
      const pendingBeforeStop = { uplink: uplink.summary(), downlink: downlink.summary() };
      uplink.stop();
      downlink.stop();
      const closedSockets = [...sockets].map(
        (socket) => new Promise((done) => (socket.closed ? done() : socket.once('close', done))),
      );
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        ...closedSockets,
        ...[proxy, httpsServer].map(
          (server) => new Promise((done) => (server.listening ? server.close(done) : done())),
        ),
      ]);
      writeNew(
        logPrefix + '-requests.jsonl',
        requests.map((row) => JSON.stringify(row)).join('\n') + '\n',
      );
      writeNew(
        logPrefix + '-summary.json',
        JSON.stringify(
          {
            endedAt: new Date().toISOString(),
            durationMs: performance.now() - started,
            serverProcessCpuMicroseconds: process.cpuUsage(cpuStarted),
            requestCount: requests.length,
            pendingBeforeStop,
            connections,
            uplink: uplink.summary(),
            downlink: downlink.summary(),
            remainingSockets: sockets.size,
          },
          null,
          2,
        ) + '\n',
      );
    })();
    return stopping;
  };
  try {
    await listen(httpsServer, internalPort);
    await listen(proxy, port);
    writeNew(logPrefix + '-server.json', JSON.stringify(metadata, null, 2) + '\n');
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    origin,
    internalOrigin: metadata.internalOrigin,
    metadata,
    stop,
    getRequestCount: () => requests.length,
    snapshotRequests: (startIndex = 0) => {
      if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > requests.length)
        throw new Error('Invalid request observation offset');
      return globalThis.structuredClone(requests.slice(startIndex));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      'internal-port': { type: 'string' },
      pfx: { type: 'string' },
      certificate: { type: 'string' },
      'log-prefix': { type: 'string' },
    },
  });
  const server = await startPerformanceServer({
    port: values.port,
    internalPort: values['internal-port'],
    pfx: values.pfx,
    certificate: values.certificate,
    logPrefix: values['log-prefix'],
  });
  console.log(`Performance HTTPS and shared 20/5 Mbps, 40 ms RTT: ${server.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
}
