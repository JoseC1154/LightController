/*
  Lightweight Node helper for local network discovery.
  - Starts an HTTP server with endpoints:
    GET /devices     -> returns JSON list of discovered devices
    POST /scan       -> triggers an SSDP/MDNS scan (returns 202)

  Install: npm install
  Run: npm start
 */

const express = require('express');
const cors = require('cors');
const bonjour = require('bonjour')();
const { Client: SsdpClient } = require('node-ssdp');
const net = require('net');
const dgram = require('dgram');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory device store: Map<id, device>
const devices = new Map();

function upsertDevice(id, obj) {
  const now = Date.now();
  const existing = devices.get(id) || {};
  devices.set(id, { id, updatedAt: now, createdAt: existing.createdAt || now, ...existing, ...obj });
}

// mDNS (bonjour) - discover http services
try {
  bonjour.find({ type: 'http' }, (service) => {
    const id = `mdns-${service.fqdn || service.name || service.host || service.referer?.address || JSON.stringify(service)}`;
    upsertDevice(id, {
      name: service.name || service.fqdn,
      addresses: service.addresses || [],
      port: service.port,
      txt: service.txt || {},
      source: 'mdns',
      raw: service
    });
  });
} catch (e) {
  console.warn('mDNS (bonjour) initialization failed:', e?.message || e);
}

// SSDP discovery
const ssdp = new SsdpClient();
ssdp.on('response', (headers, statusCode, rinfo) => {
  const id = `ssdp-${rinfo.address}-${(headers.ST || headers.NT || 'device').replace(/[^a-z0-9\-_.:]/gi, '_')}`;
  upsertDevice(id, {
    name: headers.SERVER || headers.ST || headers.NT || `ssdp-${rinfo.address}`,
    addresses: [rinfo.address],
    info: headers,
    source: 'ssdp'
  });
});

function performSsdpSearch() {
  try {
    ssdp.search('ssdp:all');
    // send several times to increase chance of discovery
    setTimeout(() => ssdp.search('ssdp:all'), 1000);
    setTimeout(() => ssdp.search('ssdp:all'), 2000);
  } catch (e) {
    console.warn('SSDP search failed:', e?.message || e);
  }
}

// Initial scan
performSsdpSearch();

// HTTP API
app.get('/devices', (req, res) => {
  res.json(Array.from(devices.values()).map(d => ({ id: d.id, name: d.name, addresses: d.addresses, source: d.source, updatedAt: d.updatedAt })));
});

app.post('/scan', (req, res) => {
  performSsdpSearch();
  res.status(202).json({ ok: true, message: 'Scan started' });
});

app.post('/clear', (req, res) => {
  devices.clear();
  res.json({ ok: true });
});

app.get('/', (req, res) => res.json({ ok: true, devices: devices.size }));

// Probe a target URL from the helper (server-side) to avoid CORS and get headers/body
app.get('/probe', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ ok: false, error: 'Missing url parameter' });

  try {
    const u = new URL(target);
    const mod = u.protocol === 'https:' ? require('https') : require('http');

    const opts = {
      method: 'GET',
      timeout: 3000,
      headers: {
        'User-Agent': 'LightController-Helper/1.0'
      }
    };

    const collect = await new Promise((resolve, reject) => {
      const req2 = mod.request(u, opts, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: resp.statusCode, headers: resp.headers, body: body.slice(0, 2000) });
        });
      });

      req2.on('error', (e) => reject(e));
      req2.on('timeout', () => {
        req2.destroy();
        reject(new Error('Timeout'));
      });
      req2.end();
    });

    res.json({ ok: true, url: target, ...collect });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) });
  }
});

// Helper: TCP connect check
function tcpConnectCheck(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const onDone = (obj) => { if (done) return; done = true; try { sock.destroy(); } catch(e){}; resolve(obj); };

    sock.setTimeout(timeout, () => onDone({ ok: false, error: 'timeout' }));
    sock.once('error', (err) => onDone({ ok: false, error: String(err.message || err) }));
    sock.connect(port, host, () => onDone({ ok: true }));
  });
}

// Helper: UDP probe (basic) - send empty packet and wait for response (LIFX detection)
function udpProbe(host, port = 56700, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let timer;
    let done = false;
    const finish = (obj) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch(e){}; resolve(obj); };

    sock.on('message', (msg, rinfo) => {
      finish({ ok: true, from: rinfo.address, data: msg.toString('hex').slice(0,200) });
    });
    sock.on('error', (err) => finish({ ok: false, error: String(err) }));

    // send an empty packet (some devices respond to discovery packets)
    try {
      sock.send(Buffer.from(''), port, host, (err) => {
        if (err) finish({ ok: false, error: String(err) });
        timer = setTimeout(() => finish({ ok: false, error: 'no-response' }), timeout);
      });
    } catch (e) {
      finish({ ok: false, error: String(e) });
    }
  });
}

// Extended scan across discovered devices: TCP port checks + simple HTTP probes + UDP probe
app.get('/extended-scan', async (req, res) => {
  const ports = [80, 443, 8080, 8081, 10000, 55443, 56700];
  const httpPaths = ['', '/json', '/json/state', '/description.xml', '/status', '/api'];

  const out = [];
  const list = Array.from(devices.values()).map(d => ({ id: d.id, name: d.name, addresses: d.addresses || [], port: d.port }));

  for (const d of list) {
    const addr = (d.addresses && d.addresses[0]) || null;
    if (!addr) continue;
    const item = { id: d.id, name: d.name, address: addr, checks: {} };

    // TCP port checks
    const tcpChecks = await Promise.all(ports.map(async (p) => {
      try {
        const r = await tcpConnectCheck(addr, p, 1500);
        return { port: p, open: !!r.ok, error: r.ok ? undefined : r.error };
      } catch (e) { return { port: p, open: false, error: String(e) }; }
    }));
    item.checks.tcp = tcpChecks;

    // If common HTTP ports open, probe http paths via existing probe logic
    const httpOpen = tcpChecks.filter(c => [80,8080,10000].includes(c.port) && c.open).map(c => c.port);
    item.checks.http = [];
    for (const p of httpOpen) {
      for (const path of httpPaths) {
        const url = `http://${addr}:${p}${path}`;
        try {
          // reuse probe logic by calling internal request
          const u = new URL(url);
          const mod = u.protocol === 'https:' ? require('https') : require('http');
          const probeRes = await new Promise((resolve, reject) => {
            const opts = { method: 'GET', timeout: 3000, headers: { 'User-Agent': 'LightController-Helper/1.0' } };
            const req2 = mod.request(u, opts, (resp) => {
              const chunks = [];
              resp.on('data', (c) => chunks.push(c));
              resp.on('end', () => resolve({ statusCode: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString('utf8').slice(0,1000) }));
            });
            req2.on('error', (e) => reject(e));
            req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
            req2.end();
          });
          item.checks.http.push({ url, ok: true, statusCode: probeRes.statusCode, headers: probeRes.headers });
        } catch (e) {
          item.checks.http.push({ url, ok: false, error: String(e) });
        }
      }
    }

    // UDP probe (LIFX) on 56700
    try {
      const udp = await udpProbe(addr, 56700, 1200);
      item.checks.udp_56700 = udp;
    } catch (e) {
      item.checks.udp_56700 = { ok: false, error: String(e) };
    }

    out.push(item);
  }

  // store results in-memory for retrieval
  app.locals.lastExtendedScan = { ts: Date.now(), results: out };
  res.json({ ok: true, scanned: out.length, results: out });
});

app.get('/scan-results', (req, res) => {
  res.json(app.locals.lastExtendedScan || { ok: false, error: 'no-scan' });
});

// Proxy a request from the UI through the helper to bypass CORS and network restrictions
app.post('/proxy', async (req, res) => {
  const { url, method = 'GET', headers = {}, body = null, timeout = 5000 } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url in body' });

  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? require('https') : require('http');

    const opts = {
      method: method || 'GET',
      timeout,
      headers: Object.assign({ 'User-Agent': 'LightController-Helper/1.0' }, headers)
    };

    const collect = await new Promise((resolve, reject) => {
      const req2 = mod.request(u, opts, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: resp.statusCode, headers: resp.headers, body: bodyStr.slice(0, 2000) });
        });
      });

      req2.on('error', (e) => reject(e));
      req2.on('timeout', () => {
        req2.destroy();
        reject(new Error('Timeout'));
      });

      if (body) {
        try {
          if (typeof body === 'object') req2.write(JSON.stringify(body));
          else req2.write(String(body));
        } catch (e) {
          // ignore write errors
        }
      }

      req2.end();
    });

    res.json({ ok: true, url, ...collect });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`LightController Node helper running on http://0.0.0.0:${PORT}`);
  console.log('Endpoints: GET /devices   POST /scan   POST /clear');
});
