// FILE: app.js

/* =========================================================
   Scene Controller
   - Devices + Scenes (multi-device scenes)
   - Provider layer: mock + generic_http
   - Local persistence via localStorage
   ========================================================= */

/* ---------- Storage Keys ---------- */
const STORAGE_KEYS = {
  DEVICES: "sceneController.devices",
  SCENES: "sceneController.scenes"
};

/* ---------- State ---------- */
let devices = loadJSON(STORAGE_KEYS.DEVICES, []);
let scenes = loadJSON(STORAGE_KEYS.SCENES, []);

/* Builder runtime state (per selected devices) */
let builderStateByDevice = {}; // { [deviceId]: { power, colorHex, brightness } }

/* ---------- DOM ---------- */
const tabScenes = document.getElementById("tabScenes");
const tabDevices = document.getElementById("tabDevices");
const viewScenes = document.getElementById("viewScenes");
const viewDevices = document.getElementById("viewDevices");

const deviceListEl = document.getElementById("deviceList");
const devicePickListEl = document.getElementById("devicePickList");
const sceneListEl = document.getElementById("sceneList");

const controlsPanelEl = document.getElementById("controlsPanel");
const controlsHintEl = document.getElementById("controlsHint");

const btnAddDevice = document.getElementById("btnAddDevice");
const btnScanNetwork = document.getElementById("btnScanNetwork");
const btnFetchHelper = document.getElementById("btnFetchHelper");
const btnHelperSettings = document.getElementById("btnHelperSettings");
const btnExtendedScan = document.getElementById("btnExtendedScan");
const btnApplyNow = document.getElementById("btnApplyNow");
const btnSaveScene = document.getElementById("btnSaveScene");

const sceneNameInput = document.getElementById("sceneName");
const builderMessageEl = document.getElementById("builderMessage");

const statusTextEl = document.getElementById("statusText");
const statusDotEl = document.getElementById("statusDot");

// Modal
const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalFooter = document.getElementById("modalFooter");
const btnCloseModal = document.getElementById("btnCloseModal");

/* ---------- Utilities ---------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return "id-" + Math.random().toString(36).slice(2, 11);
}

function now() {
  return Date.now();
}

function clamp(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function isValidHexColor(hex) {
  return typeof hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(hex);
}

function setBuilderMessage(msg) {
  builderMessageEl.textContent = msg || "";
}

/* ---------- Provider Layer ---------- */

async function applyDeviceState(device, state) {
  try {
    switch (device.provider) {
      case "mock":
        return mockApply(device, state);

      case "generic_http":
        return genericHttpApply(device, state);

      // implement common providers
      case "wled":
        // WLED devices typically accept HTTP POST/GET; prefer endpoint if provided
        if (device.endpoint) return genericHttpApply(device, state);
        return mockApply(device, state);

      case "tuya":
      case "hue":
      default:
        throw new Error("Provider not implemented: " + device.provider);
    }
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function mockApply(device, state) {
  console.log("MOCK APPLY:", device.name, state);
  return { ok: true };
}

async function genericHttpApply(device, state) {
  if (!device.endpoint) {
    return { ok: false, error: "Missing endpoint" };
  }

  const payload = {
    deviceId: device.id,
    type: device.type,
    state
  };

  // Try direct fetch first
  try {
    const res = await fetch(device.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn('Direct fetch failed, attempting helper proxy:', err);

    // Fallback to the local helper proxy if configured
    try {
      const helperUrl = getHelperUrl();
      const proxyRes = await fetch(helperUrl.replace(/\/+$/, '') + '/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: device.endpoint, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      });
      const j = await proxyRes.json();
      if (j.ok) return { ok: j.statusCode >= 200 && j.statusCode < 300, status: j.statusCode, proxy: true };
      return { ok: false, error: j.error || 'proxy failed' };
    } catch (err2) {
      console.error('Proxy request failed:', err2);
      return { ok: false, error: String(err2 || err) };
    }
  }
}

/* ---------- Tabs ---------- */
tabScenes.addEventListener("click", () => switchTab("scenes"));
tabDevices.addEventListener("click", () => switchTab("devices"));

function switchTab(tab) {
  if (tab === "scenes") {
    viewScenes.hidden = false;
    viewDevices.hidden = true;
    tabScenes.classList.add("isActive");
    tabDevices.classList.remove("isActive");
    tabScenes.setAttribute("aria-current", "page");
    tabDevices.removeAttribute("aria-current");
  } else {
    viewScenes.hidden = true;
    viewDevices.hidden = false;
    tabDevices.classList.add("isActive");
    tabScenes.classList.remove("isActive");
    tabDevices.setAttribute("aria-current", "page");
    tabScenes.removeAttribute("aria-current");
  }
}

/* ---------- Modal helpers ---------- */
btnCloseModal?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", closeModal);

function openModal(title, bodyHTML, footerHTML) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  modalFooter.innerHTML = footerHTML || "";
  modal.hidden = false;
  modalBackdrop.hidden = false;

  // focus first input if present
  const first = modal.querySelector("input,select,button,textarea");
  if (first) first.focus();
}

function closeModal() {
  modal.hidden = true;
  modalBackdrop.hidden = true;
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
}

/* ---------- Devices ---------- */

btnAddDevice.addEventListener("click", () => {
  openDeviceEditor();
});

// Network scan (browser-only, best-effort)
btnScanNetwork?.addEventListener("click", () => {
  openNetworkScanner();
});

btnFetchHelper?.addEventListener("click", () => {
  fetchHelperDevices();
});

btnHelperSettings?.addEventListener("click", () => {
  openHelperSettings();
});

function getHelperUrl() {
  return localStorage.getItem('lc.helperUrl') || 'http://localhost:3000';
}

function setHelperUrl(u) {
  localStorage.setItem('lc.helperUrl', u);
}

function openHelperSettings() {
  const current = getHelperUrl();
  const body = `
    <div class="field">
      <span class="field__label">Helper URL</span>
      <input class="input" id="helperUrlInput" type="text" value="${escapeAttr(current)}" placeholder="http://localhost:3000" />
      <div class="tiny muted" style="margin-top:6px;">Enter the Node helper base URL (including protocol and port).</div>
    </div>
  `;

  const footer = `
    <div class="actions" style="margin:0;">
      <button class="btn" id="btnCancelHelper" type="button">Cancel</button>
      <button class="btn btnPrimary" id="btnSaveHelper" type="button">Save</button>
    </div>
  `;

  openModal('Helper settings', body, footer);
  document.getElementById('btnCancelHelper').addEventListener('click', closeModal);
  document.getElementById('btnSaveHelper').addEventListener('click', () => {
    const v = document.getElementById('helperUrlInput').value.trim();
    if (!v) {
      alert('Please enter a helper URL.');
      return;
    }
    setHelperUrl(v);
    setBuilderMessage('Helper URL saved.');
    closeModal();
  });
}

async function fetchHelperDevices() {
  openModal("Fetch helper devices", `<div class=\"muted\">Fetching from helper...</div>`);

// Extended scan via helper: shows TCP/HTTP/UDP probe results and suggests HTTP-add candidates
btnExtendedScan?.addEventListener('click', async () => {
  openModal('Extended scan', `<div class="muted">Running extended scan (TCP/HTTP/UDP)...</div>`);
  const helperUrl = getHelperUrl();
  try {
    const res = await fetch(helperUrl.replace(/\/+$/, '') + '/extended-scan', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j.ok || !Array.isArray(j.results)) {
      modalBody.innerHTML = `<div class="muted">No results from helper.</div>`;
      modalFooter.innerHTML = `<div class="actions"><button class="btn" id="btnCloseExt">Close</button></div>`;
      document.getElementById('btnCloseExt').addEventListener('click', closeModal);
      return;
    }

    let html = `<div style="max-height:440px;overflow:auto;font-family:monospace;font-size:12px;">`;
    const candidates = [];
    for (const it of j.results) {
      html += `<div style="border-bottom:1px solid #eee;padding:8px 0;"><strong>${escapeHtml(it.name || it.address)}</strong> <span class="tiny muted">${escapeHtml(it.address)}</span>`;
      // tcp
      const openPorts = (it.checks?.tcp || []).filter(c => c.open).map(c => c.port);
      html += `<div class="tiny muted">Open TCP: ${openPorts.length?openPorts.join(', '):'none'}</div>`;

      // http
      if (it.checks?.http && it.checks.http.length) {
        html += `<div style="margin-top:6px;">HTTP probes:`;
        for (const h of it.checks.http) {
          const ok = h.ok;
          html += `<div style="margin-top:6px;padding:6px;border:1px solid #f3f3f3;background:#fff;">
            <div><strong>${escapeHtml(h.url)}</strong> — ${ok?('Status '+h.statusCode):escapeHtml(h.error||'fail')}</div>`;
          if (ok && h.headers && (String(h.headers['content-type']||'').includes('application/json') || JSON.stringify(h).toLowerCase().includes('wled') || JSON.stringify(h).toLowerCase().includes('wled'))) {
            // candidate HTTP device
            candidates.push({ address: it.address, url: h.url });
            html += `<div class="tiny muted">Looks like JSON HTTP — candidate for Generic HTTP</div>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }

      // udp
      if (it.checks?.udp_56700) {
        html += `<div class="tiny muted">UDP 56700: ${it.checks.udp_56700.ok?('response from '+escapeHtml(it.checks.udp_56700.from||'')):escapeHtml(it.checks.udp_56700.error||'no response')}</div>`;
        if (it.checks.udp_56700.ok) {
          html += `<div class="tiny muted">UDP response suggests LIFX/UDP device.</div>`;
        }
      }

      html += `</div>`;
    }

    // build footer with candidate add buttons
    let footerHtml = `<div class="actions" style="margin:0;">`;
    footerHtml += `<button class="btn" id="btnCloseExt2">Close</button>`;
    if (candidates.length) {
      footerHtml += `<button class="btn btnPrimary" id="btnAddCandidates">Add ${candidates.length} HTTP candidate(s)</button>`;
    }
    footerHtml += `</div>`;

    modalBody.innerHTML = html + `</div>`;
    modalFooter.innerHTML = footerHtml;
    document.getElementById('btnCloseExt2').addEventListener('click', closeModal);

    const addBtn = document.getElementById('btnAddCandidates');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        for (const c of candidates) {
          // choose root endpoint (strip path)
          try {
            const u = new URL(c.url);
            const endpoint = `${u.protocol}//${u.hostname}${u.port?(':'+u.port):''}/`;
            const dev = { id: uid(), name: `Discovered ${u.hostname}`, type: 'light', provider: 'generic_http', endpoint, capabilities: defaultCapabilitiesForType('light') };
            devices.push(dev);
          } catch (e) {
            console.warn('Bad candidate URL', c.url);
          }
        }
        persistDevices();
        renderAll();
        setBuilderMessage(`Added ${candidates.length} candidate device(s)`);
        closeModal();
      });
    }

  } catch (err) {
    modalBody.innerHTML = `<div class="muted">Extended scan failed: ${escapeHtml(String(err))}</div>`;
    modalFooter.innerHTML = `<div class="actions"><button class="btn" id="btnCloseExtErr">Close</button></div>`;
    document.getElementById('btnCloseExtErr').addEventListener('click', closeModal);
  }
});

  const helperUrl = getHelperUrl();
  try {
    const res = await fetch(helperUrl.replace(/\/+$/, '') + '/devices', { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();

    if (!Array.isArray(list) || !list.length) {
      modalBody.innerHTML = `<div class=\"muted\">No devices reported by helper.</div>`;
      modalFooter.innerHTML = `<div class=\"actions\"><button class=\"btn\" id=\"btnCloseModal2\">Close</button></div>`;
      document.getElementById("btnCloseModal2").addEventListener("click", closeModal);
      return;
    }

    // build UI
    let html = `<div style=\"max-height:320px;overflow:auto;\">`;
    for (const d of list) {
      const addr = (d.addresses && d.addresses[0]) || (d.addresses || []).join(',') || '';
      const displayName = escapeHtml(d.name || d.id || addr);
      const rootUrl = addr ? (window.location.protocol === 'https:' ? `https://${addr}${d.port?(':'+d.port):''}/` : `http://${addr}${d.port?(':'+d.port):''}/`) : '';
      html += `
        <div class=\"devicePickRow\" style=\"margin-bottom:10px;\">
          <div style=\"display:flex;align-items:center;justify-content:space-between;\">
            <div style=\"flex:1;\"> <strong>${displayName}</strong>
              <div class=\"tiny muted\">${escapeHtml(addr)} ${d.port?(':'+d.port):''} • ${escapeHtml(d.source||'')}</div>
            </div>
            <div style=\"margin-left:8px;display:flex;gap:8px;align-items:center;\">
              <button class=\"btn\" data-probe-url=\"${escapeAttr(rootUrl)}\">Probe</button>
              <button class=\"btn btnPrimary\" data-add-ip=\"${escapeAttr(addr)}\" data-add-port=\"${d.port||''}\">Add</button>
            </div>
          </div>
          <div class=\"tiny muted\" data-probe-result-for=\"${escapeAttr(rootUrl)}\" style=\"margin-top:6px;white-space:pre-wrap;max-height:160px;overflow:auto;\"></div>
        </div>`;
    }
    html += `</div>`;

    modalBody.innerHTML = html;
    modalFooter.innerHTML = `<div class=\"actions\"><button class=\"btn\" id=\"btnCloseModal3\">Close</button></div>`;
    document.getElementById("btnCloseModal3").addEventListener("click", closeModal);

    // wire probe buttons
    modalBody.querySelectorAll("button[data-probe-url]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.getAttribute("data-probe-url");
        const resultEl = modalBody.querySelector(`[data-probe-result-for=\"${escapeAttr(url)}\"]`);
        if (!url) {
          if (resultEl) resultEl.textContent = 'No address to probe.';
          return;
        }
        btn.textContent = 'Probing...';
        try {
          const helperUrl = getHelperUrl();
          const res = await fetch(helperUrl.replace(/\/+$/, '') + '/probe?url=' + encodeURIComponent(url));
          const j = await res.json();
          if (j.ok) {
            const h = JSON.stringify(j.headers || {}, null, 2);
            const bodySnippet = j.body ? j.body.slice(0, 1000) : '';
            if (resultEl) resultEl.textContent = `Status: ${j.statusCode}\n\nHeaders:\n${h}\n\nBody snippet:\n${bodySnippet}`;
          } else {
            if (resultEl) resultEl.textContent = `Probe failed: ${j.error || 'unknown'}`;
          }
        } catch (err) {
          if (resultEl) resultEl.textContent = `Probe error: ${String(err)}`;
        }
        btn.textContent = 'Probe';
      });
    });

    // wire add buttons
    modalBody.querySelectorAll("button[data-add-ip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ip = btn.getAttribute("data-add-ip");
        const port = btn.getAttribute("data-add-port");
        const endpoint = ip ? (window.location.protocol === 'https:' ? `https://${ip}${port?(':'+port):''}/` : `http://${ip}${port?(':'+port):''}/`) : '';

        const dev = {
          id: uid(),
          name: `Discovered ${ip}`,
          type: "light",
          provider: "generic_http",
          endpoint,
          capabilities: defaultCapabilitiesForType("light")
        };

        devices.push(dev);
        persistDevices();
        renderAll();
        setBuilderMessage(`Added ${ip}`);
      });
    });

  } catch (err) {
    const msg = String(err || 'Error');
    modalBody.innerHTML = `<div class=\"muted\">Failed to fetch helper devices from <strong>${escapeHtml(helperUrl)}</strong>: ${escapeHtml(msg)}</div>`;
    modalBody.innerHTML += `<div class=\"tiny muted\" style=\"margin-top:8px;\">Start the helper with:<br/><code>npm install && npm start</code> (run in the repo)</div>`;
    modalFooter.innerHTML = `<div class=\"actions\"><button class=\"btn\" id=\"btnCloseModal4\">Close</button></div>`;
    document.getElementById("btnCloseModal4").addEventListener("click", closeModal);
  }
}

function openNetworkScanner() {
  const body = `
    <div class="field">
      <span class="field__label">IP base</span>
      <input class="input" id="scanBase" type="text" placeholder="e.g., 192.168.1" value="192.168.1" />
    </div>
    <div class="fieldRow">
      <div style="flex:1; margin-right:8px;">
        <span class="field__label">Start</span>
        <input class="input" id="scanStart" type="number" min="1" max="254" value="1" />
      </div>
      <div style="flex:1;">
        <span class="field__label">End</span>
        <input class="input" id="scanEnd" type="number" min="1" max="254" value="30" />
      </div>
    </div>
    <div class="field">
      <span class="field__label">Probe path</span>
      <input class="input" id="scanPath" type="text" placeholder="e.g., /" value="/" />
      <div class="tiny muted" style="margin-top:6px;">Uses fetch with <code>mode: 'no-cors'</code> to detect responsive hosts. CORS may prevent reading responses; this only detects reachable endpoints.</div>
    </div>
    <div class="divider"></div>
    <div id="scanResults" style="max-height:240px; overflow:auto;"></div>
  `;

  const footer = `
    <div class="actions" style="margin:0;">
      <button class="btn" id="btnCancelScan" type="button">Close</button>
      <button class="btn btnPrimary" id="btnStartScan" type="button">Start scan</button>
    </div>
  `;

  openModal("Scan local network", body, footer);

  document.getElementById("btnCancelScan").addEventListener("click", closeModal);

  document.getElementById("btnStartScan").addEventListener("click", async () => {
    const base = document.getElementById("scanBase").value.trim();
    const start = clamp(Number(document.getElementById("scanStart").value), 1, 254);
    const end = clamp(Number(document.getElementById("scanEnd").value), 1, 254);
    const path = document.getElementById("scanPath").value || "/";

    const resultsEl = document.getElementById("scanResults");
    resultsEl.innerHTML = "Scanning...";

    try {
      const found = await scanIpRange(base, start, end, path, {concurrency:40, timeout:2500});
      if (!found.length) {
        resultsEl.innerHTML = `<div class=\"muted\">No responsive hosts found in the given range.</div>`;
        return;
      }

      resultsEl.innerHTML = "";
      for (const ip of found) {
        const row = document.createElement("div");
        row.className = "devicePickRow";
        row.innerHTML = `
          <div style=\"display:flex;align-items:center;justify-content:space-between;\">
            <div>${ip}</div>
            <div>
              <button class=\"btn\" data-ip=\"${ip}\" type=\"button\">Probe</button>
              <button class=\"btn btnPrimary\" data-add=\"${ip}\" type=\"button\">Add</button>
            </div>
          </div>
        `;

        row.querySelectorAll("button").forEach((b) => {
          b.addEventListener("click", async () => {
            const ip = b.getAttribute("data-ip") || b.getAttribute("data-add");
            if (b.hasAttribute("data-ip")) {
              // show probe details
              b.textContent = "Probing...";
              try {
                const ok = await probeHost(ip, path, 2000);
                b.textContent = ok ? "Responsive" : "No response";
              } catch (e) {
                b.textContent = "Error";
              }
              setTimeout(() => (b.textContent = "Probe"), 1200);
              return;
            }

            // Add discovered host as generic_http device
            const endpoint = window.location.protocol === "https:" ? `https://${ip}${path}` : `http://${ip}${path}`;
            const dev = {
              id: uid(),
              name: `Discovered ${ip}`,
              type: "light",
              provider: "generic_http",
              endpoint,
              capabilities: defaultCapabilitiesForType("light")
            };
            devices.push(dev);
            persistDevices();
            renderAll();
            setBuilderMessage(`Added ${ip}`);
          });
        });

        resultsEl.appendChild(row);
      }
    } catch (err) {
      document.getElementById("scanResults").innerHTML = `<div class=\"muted\">Scan failed: ${escapeHtml(String(err))}</div>`;
    }
  });
}

async function scanIpRange(base, start, end, path, opts = {}) {
  const found = [];
  const concurrency = opts.concurrency || 20;
  const timeout = opts.timeout || 2000;

  const ips = [];
  for (let i = start; i <= end; i++) {
    ips.push(`${base}.${i}`);
  }

  let idx = 0;
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (idx < ips.length) {
      const i = idx++;
      const ip = ips[i];
      try {
        const ok = await probeHost(ip, path, timeout);
        if (ok) found.push(ip);
      } catch (e) {
        // ignore
      }
    }
  });

  await Promise.all(workers);
  return found;
}

async function probeHost(ip, path, timeout = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = `${window.location.protocol === 'https:' ? 'https' : 'http'}://${ip}${path}`;
  try {
    // mode:no-cors allows the request to succeed in many local cases
    await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch (err) {
    clearTimeout(timer);
    return false;
  }
}

function persistDevices() {
  saveJSON(STORAGE_KEYS.DEVICES, devices);
}

function persistScenes() {
  saveJSON(STORAGE_KEYS.SCENES, scenes);
}

function defaultCapabilitiesForType(type) {
  if (type === "light") {
    return { power: true, brightness: true, color: true, temperature: false };
  }
  if (type === "plug" || type === "switch") {
    return { power: true, brightness: false, color: false, temperature: false };
  }
  return { power: true, brightness: false, color: false, temperature: false };
}

function openDeviceEditor(existingId) {
  const existing = existingId ? devices.find((d) => d.id === existingId) : null;

  const d = existing || {
    id: uid(),
    name: "",
    type: "light",
    provider: "mock",
    endpoint: "",
    capabilities: defaultCapabilitiesForType("light")
  };

  const body = `
    <div class="field">
      <span class="field__label">Name</span>
      <input class="input" id="devName" type="text" maxlength="40" placeholder="e.g., Living Room Strip" value="${escapeAttr(d.name)}" />
    </div>

    <div class="field">
      <span class="field__label">Type</span>
      <select class="input" id="devType">
        <option value="light" ${d.type === "light" ? "selected" : ""}>Light</option>
        <option value="plug" ${d.type === "plug" ? "selected" : ""}>Plug</option>
        <option value="switch" ${d.type === "switch" ? "selected" : ""}>Switch</option>
        <option value="other" ${d.type === "other" ? "selected" : ""}>Other</option>
      </select>
    </div>

    <div class="field">
      <span class="field__label">Provider</span>
      <select class="input" id="devProvider">
        <option value="mock" ${d.provider === "mock" ? "selected" : ""}>Mock</option>
        <option value="generic_http" ${d.provider === "generic_http" ? "selected" : ""}>Generic HTTP</option>
        <option value="wled" ${d.provider === "wled" ? "selected" : ""}>WLED (placeholder)</option>
        <option value="tuya" ${d.provider === "tuya" ? "selected" : ""}>Tuya (placeholder)</option>
        <option value="hue" ${d.provider === "hue" ? "selected" : ""}>Hue (placeholder)</option>
      </select>
      <div class="tiny muted" style="margin-top:6px;">Generic HTTP sends a POST with { deviceId, type, state }.</div>
    </div>

    <div class="field" id="endpointWrap">
      <span class="field__label">Endpoint (for Generic HTTP)</span>
      <input class="input" id="devEndpoint" type="url" placeholder="https://example.com/device" value="${escapeAttr(d.endpoint || "")}" />
    </div>

    <div class="divider"></div>

    <div class="sectionTitle">Capabilities</div>
    <label class="devicePickRow"><input type="checkbox" id="capPower" ${d.capabilities?.power ? "checked" : ""}/> <span>Power</span></label>
    <label class="devicePickRow"><input type="checkbox" id="capBrightness" ${d.capabilities?.brightness ? "checked" : ""}/> <span>Brightness</span></label>
    <label class="devicePickRow"><input type="checkbox" id="capColor" ${d.capabilities?.color ? "checked" : ""}/> <span>Color</span></label>
  `;

  const footer = `
    <div class="actions" style="margin:0;">
      ${existing ? `<button class="btn" id="btnDeleteDevice" type="button">Delete</button>` : ""}
      <button class="btn" id="btnCancelDevice" type="button">Cancel</button>
      <button class="btn btnPrimary" id="btnSaveDevice" type="button">Save</button>
    </div>
  `;

  openModal(existing ? "Edit device" : "Add device", body, footer);

  const devType = document.getElementById("devType");
  const devProvider = document.getElementById("devProvider");
  const endpointWrap = document.getElementById("endpointWrap");

  function syncEndpointVisibility() {
    const p = devProvider.value;
    endpointWrap.style.display = p === "generic_http" ? "block" : "none";
  }

  devProvider.addEventListener("change", syncEndpointVisibility);
  syncEndpointVisibility();

  devType.addEventListener("change", () => {
    // helpful defaults when type changes
    const caps = defaultCapabilitiesForType(devType.value);
    document.getElementById("capPower").checked = !!caps.power;
    document.getElementById("capBrightness").checked = !!caps.brightness;
    document.getElementById("capColor").checked = !!caps.color;
  });

  document.getElementById("btnCancelDevice").addEventListener("click", closeModal);

  if (existing) {
    document.getElementById("btnDeleteDevice").addEventListener("click", () => {
      devices = devices.filter((x) => x.id !== existing.id);

      // Also remove device references from scenes
      scenes = scenes
        .map((s) => ({
          ...s,
          items: (s.items || []).filter((it) => it.deviceId !== existing.id)
        }))
        .filter((s) => (s.items || []).length > 0);

      persistDevices();
      persistScenes();
      cleanupBuilderState();
      renderAll();
      closeModal();
    });
  }

  document.getElementById("btnSaveDevice").addEventListener("click", () => {
    const name = document.getElementById("devName").value.trim();
    const type = document.getElementById("devType").value;
    const provider = document.getElementById("devProvider").value;
    const endpoint = document.getElementById("devEndpoint")?.value.trim() || "";

    const capabilities = {
      power: document.getElementById("capPower").checked,
      brightness: document.getElementById("capBrightness").checked,
      color: document.getElementById("capColor").checked,
      temperature: false
    };

    if (!name) {
      alert("Please enter a device name.");
      return;
    }

    if (provider === "generic_http" && !endpoint) {
      alert("Please enter an endpoint for Generic HTTP, or choose Mock.");
      return;
    }

    const updated = {
      id: d.id,
      name,
      type,
      provider,
      endpoint,
      capabilities
    };

    if (existing) {
      devices = devices.map((x) => (x.id === existing.id ? updated : x));
    } else {
      devices.push(updated);
    }

    persistDevices();
    cleanupBuilderState();
    renderAll();
    closeModal();
  });
}

function escapeAttr(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderDevices() {
  deviceListEl.innerHTML = "";

  if (!devices.length) {
    deviceListEl.innerHTML = `<div class="muted">No devices yet. Tap <b>Add device</b>.</div>`;
    return;
  }

  for (const d of devices) {
    const card = document.createElement("div");
    card.className = "deviceCard";

    const caps = summarizeCaps(d.capabilities);

    card.innerHTML = `
      <div class="deviceName">${escapeHtml(d.name)}</div>
      <div class="deviceMeta">${escapeHtml(d.provider)} • ${escapeHtml(d.type)} • ${escapeHtml(caps)}</div>
      <div class="deviceActions">
        <button class="btn" type="button" data-action="edit" data-id="${d.id}">Edit</button>
        <button class="btn btnDelete" type="button" data-action="delete" data-id="${d.id}">Delete</button>
      </div>
    `;

    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");

        if (action === "edit") {
          openDeviceEditor(id);
          return;
        }

        if (action === "delete") {
          // confirm delete
          const dev = devices.find((x) => x.id === id);
          if (!dev) return;
          if (!confirm(`Delete device “${dev.name}”? This removes it from scenes too.`)) return;

          devices = devices.filter((x) => x.id !== id);
          scenes = scenes
            .map((s) => ({ ...s, items: (s.items || []).filter((it) => it.deviceId !== id) }))
            .filter((s) => (s.items || []).length > 0);

          persistDevices();
          persistScenes();
          cleanupBuilderState();
          renderAll();
        }
      });
    });

    deviceListEl.appendChild(card);
  }
}

function summarizeCaps(caps) {
  const parts = [];
  if (caps?.power) parts.push("power");
  if (caps?.brightness) parts.push("brightness");
  if (caps?.color) parts.push("color");
  return parts.length ? parts.join(", ") : "no caps";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- Builder: Device picker ---------- */

function renderDevicePicker() {
  devicePickListEl.innerHTML = "";

  if (!devices.length) {
    devicePickListEl.innerHTML = `<div class="muted">No devices. Add one in the Devices tab.</div>`;
    return;
  }

  for (const d of devices) {
    const row = document.createElement("label");
    row.className = "devicePickRow";
    row.innerHTML = `
      <input type="checkbox" value="${d.id}" />
      <span>${escapeHtml(d.name)}</span>
    `;

    const cb = row.querySelector("input");
    cb.checked = !!builderStateByDevice[d.id];

    cb.addEventListener("change", () => {
      if (cb.checked) {
        builderStateByDevice[d.id] = builderStateByDevice[d.id] || defaultBuilderStateForDevice(d);
      } else {
        delete builderStateByDevice[d.id];
      }
      renderControlsPanel();
    });

    devicePickListEl.appendChild(row);
  }

  renderControlsPanel();
}

function defaultBuilderStateForDevice(device) {
  const s = {};
  if (device.capabilities?.power) s.power = true;
  if (device.capabilities?.color) s.colorHex = "#ffffff";
  if (device.capabilities?.brightness) s.brightness = 100;
  return s;
}

function cleanupBuilderState() {
  // Remove builder selections for devices that no longer exist
  const ids = new Set(devices.map((d) => d.id));
  for (const k of Object.keys(builderStateByDevice)) {
    if (!ids.has(k)) delete builderStateByDevice[k];
  }
}

/* ---------- Builder: Controls panel ---------- */

function renderControlsPanel() {
  controlsPanelEl.innerHTML = "";

  const selectedIds = Object.keys(builderStateByDevice);

  if (!selectedIds.length) {
    controlsHintEl.style.display = "block";
    return;
  }

  controlsHintEl.style.display = "none";

  // One compact control group per selected device
  for (const deviceId of selectedIds) {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) continue;

    const state = builderStateByDevice[deviceId] || defaultBuilderStateForDevice(device);
    builderStateByDevice[deviceId] = state;

    const group = document.createElement("div");
    group.className = "controlGroup";

    const canPower = !!device.capabilities?.power;
    const canColor = !!device.capabilities?.color;
    const canBrightness = !!device.capabilities?.brightness;

    group.innerHTML = `
      <div class="controlGroup__head">
        <div class="controlGroup__title">${escapeHtml(device.name)}</div>
        <div class="controlGroup__meta">${escapeHtml(device.type)} • ${escapeHtml(device.provider)}</div>
      </div>

      <div class="controlGroup__body">
        ${canColor ? `
          <label class="field">
            <span class="field__label">Color</span>
            <input type="color" class="colorInput" data-k="color" data-id="${deviceId}" value="${escapeAttr(state.colorHex || "#ffffff")}" />
          </label>
        ` : ""}

        ${canBrightness ? `
          <label class="field">
            <span class="field__label">Brightness <span class="tiny muted">(${clamp(state.brightness ?? 100, 0, 100)}%)</span></span>
            <input type="range" class="rangeInput" data-k="brightness" data-id="${deviceId}" min="0" max="100" value="${clamp(state.brightness ?? 100, 0, 100)}" />
          </label>
        ` : ""}

        ${canPower ? `
          <label class="fieldRow">
            <input type="checkbox" class="checkInput" data-k="power" data-id="${deviceId}" ${state.power ? "checked" : ""} />
            <span>Power On</span>
          </label>
        ` : ""}
      </div>
    `;

    controlsPanelEl.appendChild(group);
  }

  // Wire inputs
  controlsPanelEl.querySelectorAll(".colorInput").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.getAttribute("data-id");
      const val = el.value;
      if (!builderStateByDevice[id]) return;
      builderStateByDevice[id].colorHex = isValidHexColor(val) ? val : "#ffffff";
    });
  });

  controlsPanelEl.querySelectorAll(".rangeInput").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.getAttribute("data-id");
      const val = clamp(el.value, 0, 100);
      if (!builderStateByDevice[id]) return;
      builderStateByDevice[id].brightness = val;
      // Update the label text by re-rendering just the panel (simple + clean)
      renderControlsPanel();
    });
  });

  controlsPanelEl.querySelectorAll(".checkInput").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.getAttribute("data-id");
      const checked = el.checked;
      if (!builderStateByDevice[id]) return;
      builderStateByDevice[id].power = checked;
    });
  });
}

/* ---------- Apply now (builder) ---------- */

btnApplyNow.addEventListener("click", async () => {
  setBuilderMessage("");

  const selectedIds = Object.keys(builderStateByDevice);
  if (!selectedIds.length) {
    setBuilderMessage("Select at least one device.");
    return;
  }

  setBuilderMessage("Applying...");

  let okCount = 0;
  let failCount = 0;

  for (const deviceId of selectedIds) {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) continue;

    const state = builderStateByDevice[deviceId];
    const filtered = filterStateByCapabilities(state, device.capabilities);

    const res = await applyDeviceState(device, filtered);
    if (res.ok) okCount++;
    else failCount++;
  }

  setBuilderMessage(`Applied. Success: ${okCount}${failCount ? ` • Failed: ${failCount}` : ""}`);
});

function filterStateByCapabilities(state, caps) {
  const out = {};
  if (caps?.power && typeof state.power === "boolean") out.power = state.power;
  if (caps?.color && isValidHexColor(state.colorHex)) out.colorHex = state.colorHex;
  if (caps?.brightness) out.brightness = clamp(state.brightness, 0, 100);
  return out;
}

/* ---------- Save scene ---------- */

btnSaveScene.addEventListener("click", () => {
  setBuilderMessage("");

  const name = sceneNameInput.value.trim();
  if (!name) {
    setBuilderMessage("Enter a scene name.");
    return;
  }

  const selectedIds = Object.keys(builderStateByDevice);
  if (!selectedIds.length) {
    setBuilderMessage("Select at least one device.");
    return;
  }

  const items = selectedIds
    .map((deviceId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return null;
      const filtered = filterStateByCapabilities(builderStateByDevice[deviceId], device.capabilities);
      return { deviceId, state: filtered };
    })
    .filter(Boolean);

  if (!items.length) {
    setBuilderMessage("Nothing to save.");
    return;
  }

  const scene = {
    id: uid(),
    name,
    createdAt: now(),
    updatedAt: now(),
    items
  };

  scenes.push(scene);
  persistScenes();
  renderScenes();

  sceneNameInput.value = "";
  setBuilderMessage("Scene saved.");
});

/* ---------- Scene list ---------- */

function renderScenes() {
  sceneListEl.innerHTML = "";

  if (!scenes.length) {
    sceneListEl.innerHTML = `<div class="muted">No scenes yet.</div>`;
    return;
  }

  for (const s of scenes) {
    const card = document.createElement("div");
    card.className = "sceneCard";

    card.innerHTML = `
      <div class="sceneName">${escapeHtml(s.name)}</div>
      <div class="sceneMeta">${(s.items || []).length} device(s)</div>
      <div class="sceneActions">
        <button class="btn" type="button" data-action="apply" data-id="${s.id}">Apply</button>
        <button class="btn" type="button" data-action="edit" data-id="${s.id}">Load into builder</button>
        <button class="btn btnDelete" type="button" data-action="delete" data-id="${s.id}">Delete</button>
      </div>
    `;

    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        const scene = scenes.find((x) => x.id === id);
        if (!scene) return;

        if (action === "apply") {
          setBuilderMessage("Applying scene...");
          let okCount = 0;
          let failCount = 0;

          for (const item of scene.items || []) {
            const device = devices.find((d) => d.id === item.deviceId);
            if (!device) {
              failCount++;
              continue;
            }
            const res = await applyDeviceState(device, item.state);
            if (res.ok) okCount++;
            else failCount++;
          }

          setBuilderMessage(`Scene applied. Success: ${okCount}${failCount ? ` • Failed: ${failCount}` : ""}`);
          return;
        }

        if (action === "edit") {
          // Load scene into builder
          builderStateByDevice = {};
          for (const item of scene.items || []) {
            const device = devices.find((d) => d.id === item.deviceId);
            if (!device) continue;
            builderStateByDevice[item.deviceId] = {
              ...defaultBuilderStateForDevice(device),
              ...item.state
            };
          }
          sceneNameInput.value = scene.name;
          renderDevicePicker();
          renderControlsPanel();
          switchTab("scenes");
          setBuilderMessage("Loaded scene into builder.");
          return;
        }

        if (action === "delete") {
          if (!confirm(`Delete scene “${scene.name}”?`)) return;
          scenes = scenes.filter((x) => x.id !== scene.id);
          persistScenes();
          renderScenes();
          setBuilderMessage("Scene deleted.");
        }
      });
    });

    sceneListEl.appendChild(card);
  }
}

/* ---------- Status pill ---------- */
function setStatus(mode) {
  statusTextEl.textContent = mode;
  // dot stays green for now; later we can reflect per-device connection
  statusDotEl.style.opacity = "1";
}

/* ---------- Init ---------- */

function renderAll() {
  cleanupBuilderState();
  renderDevices();
  renderDevicePicker();
  renderControlsPanel();
  renderScenes();
  setStatus("Mock mode");
}

function init() {
  // Ensure arrays
  if (!Array.isArray(devices)) devices = [];
  if (!Array.isArray(scenes)) scenes = [];

  renderAll();
}

init();
