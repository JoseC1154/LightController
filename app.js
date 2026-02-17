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

      // placeholders for later
      case "wled":
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

  const res = await fetch(device.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return { ok: res.ok, status: res.status };
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
