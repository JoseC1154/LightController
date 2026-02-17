// FILE: app.js

/* =========================================================
   Scene Controller
   Core logic: devices, scenes, providers, UI rendering
   ========================================================= */

/* ---------- Storage Keys ---------- */
const STORAGE_KEYS = {
  DEVICES: "sceneController.devices",
  SCENES: "sceneController.scenes"
};

/* ---------- State ---------- */
let devices = loadJSON(STORAGE_KEYS.DEVICES, []);
let scenes = loadJSON(STORAGE_KEYS.SCENES, []);
let activeTab = "scenes";

/* ---------- DOM ---------- */
const tabScenes = document.getElementById("tabScenes");
const tabDevices = document.getElementById("tabDevices");
const viewScenes = document.getElementById("viewScenes");
const viewDevices = document.getElementById("viewDevices");

const deviceListEl = document.getElementById("deviceList");
const devicePickListEl = document.getElementById("devicePickList");
const sceneListEl = document.getElementById("sceneList");

const controlsPanel = document.getElementById("controlsPanel");
const controlsHint = document.getElementById("controlsHint");

const btnAddDevice = document.getElementById("btnAddDevice");
const btnApplyNow = document.getElementById("btnApplyNow");
const btnSaveScene = document.getElementById("btnSaveScene");

const sceneNameInput = document.getElementById("sceneName");
const builderMessage = document.getElementById("builderMessage");

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
  return "id-" + Math.random().toString(36).slice(2, 9);
}

/* ---------- Provider Layer ---------- */

async function applyDeviceState(device, state) {
  switch (device.provider) {
    case "mock":
      return mockApply(device, state);

    case "generic_http":
      return genericHttpApply(device, state);

    default:
      console.warn("Provider not implemented:", device.provider);
      return { ok: false };
  }
}

async function mockApply(device, state) {
  console.log("MOCK APPLY:", device.name, state);
  return { ok: true };
}

async function genericHttpApply(device, state) {
  if (!device.endpoint) {
    console.warn("No endpoint set for device:", device.name);
    return { ok: false };
  }

  try {
    const res = await fetch(device.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: device.id,
        state
      })
    });

    return { ok: res.ok };
  } catch (err) {
    console.error("HTTP provider error:", err);
    return { ok: false };
  }
}

/* ---------- Tabs ---------- */
tabScenes.addEventListener("click", () => switchTab("scenes"));
tabDevices.addEventListener("click", () => switchTab("devices"));

function switchTab(tab) {
  activeTab = tab;

  if (tab === "scenes") {
    viewScenes.hidden = false;
    viewDevices.hidden = true;
    tabScenes.classList.add("isActive");
    tabDevices.classList.remove("isActive");
  } else {
    viewScenes.hidden = true;
    viewDevices.hidden = false;
    tabDevices.classList.add("isActive");
    tabScenes.classList.remove("isActive");
  }
}

/* ---------- Devices ---------- */

btnAddDevice.addEventListener("click", () => {
  const name = prompt("Device name:");
  if (!name) return;

  const device = {
    id: uid(),
    name,
    type: "light",
    provider: "mock",
    endpoint: "",
    capabilities: {
      color: true,
      brightness: true,
      power: true
    }
  };

  devices.push(device);
  persistDevices();
  renderDevices();
  renderDevicePicker();
});

function persistDevices() {
  saveJSON(STORAGE_KEYS.DEVICES, devices);
}

function renderDevices() {
  deviceListEl.innerHTML = "";

  if (!devices.length) {
    deviceListEl.innerHTML = `<div class="muted">No devices yet.</div>`;
    return;
  }

  devices.forEach(d => {
    const card = document.createElement("div");
    card.className = "deviceCard";
    card.innerHTML = `
      <div class="deviceName">${d.name}</div>
      <div class="deviceMeta">${d.provider} • ${d.type}</div>
      <div class="deviceActions">
        <button data-id="${d.id}" class="btnDelete">Delete</button>
      </div>
    `;

    card.querySelector(".btnDelete").addEventListener("click", () => {
      devices = devices.filter(x => x.id !== d.id);
      persistDevices();
      renderDevices();
      renderDevicePicker();
    });

    deviceListEl.appendChild(card);
  });
}

/* ---------- Device Picker ---------- */

function renderDevicePicker() {
  devicePickListEl.innerHTML = "";

  devices.forEach(d => {
    const row = document.createElement("label");
    row.className = "devicePickRow";
    row.innerHTML = `
      <input type="checkbox" value="${d.id}" />
      <span>${d.name}</span>
    `;

    row.querySelector("input").addEventListener("change", renderControls);

    devicePickListEl.appendChild(row);
  });
}

/* ---------- Controls ---------- */

function getSelectedDeviceIds() {
  return [...devicePickListEl.querySelectorAll("input:checked")].map(
    el => el.value
  );
}

function renderControls() {
  const selected = getSelectedDeviceIds();
  controlsPanel.innerHTML = "";

  if (!selected.length) {
    controlsHint.style.display = "block";
    return;
  }

  controlsHint.style.display = "none";

  controlsPanel.innerHTML = `
    <label class="field">
      <span>Color</span>
      <input type="color" id="controlColor" value="#ffffff" />
    </label>

    <label class="field">
      <span>Brightness</span>
      <input type="range" id="controlBrightness" min="0" max="100" value="100" />
    </label>

    <label class="fieldRow">
      <input type="checkbox" id="controlPower" checked />
      <span>Power On</span>
    </label>
  `;
}

/* ---------- Scene Apply ---------- */

btnApplyNow.addEventListener("click", async () => {
  const selected = getSelectedDeviceIds();
  if (!selected.length) return;

  const color = document.getElementById("controlColor")?.value;
  const brightness = document.getElementById("controlBrightness")?.value;
  const power = document.getElementById("controlPower")?.checked;

  for (const id of selected) {
    const device = devices.find(d => d.id === id);
    if (!device) continue;

    await applyDeviceState(device, {
      colorHex: color,
      brightness,
      power
    });
  }

  builderMessage.textContent = "Applied to devices.";
});

/* ---------- Scene Save ---------- */

btnSaveScene.addEventListener("click", () => {
  const name = sceneNameInput.value.trim();
  if (!name) {
    builderMessage.textContent = "Enter a scene name.";
    return;
  }

  const selected = getSelectedDeviceIds();
  if (!selected.length) {
    builderMessage.textContent = "Select at least one device.";
    return;
  }

  const color = document.getElementById("controlColor")?.value;
  const brightness = document.getElementById("controlBrightness")?.value;
  const power = document.getElementById("controlPower")?.checked;

  const scene = {
    id: uid(),
    name,
    createdAt: Date.now(),
    items: selected.map(deviceId => ({
      deviceId,
      state: { colorHex: color, brightness, power }
    }))
  };

  scenes.push(scene);
  saveJSON(STORAGE_KEYS.SCENES, scenes);

  sceneNameInput.value = "";
  renderScenes();
  builderMessage.textContent = "Scene saved.";
});

/* ---------- Scene List ---------- */

function renderScenes() {
  sceneListEl.innerHTML = "";

  if (!scenes.length) {
    sceneListEl.innerHTML = `<div class="muted">No scenes yet.</div>`;
    return;
  }

  scenes.forEach(scene => {
    const card = document.createElement("div");
    card.className = "sceneCard";

    card.innerHTML = `
      <div class="sceneName">${scene.name}</div>
      <div class="sceneMeta">${scene.items.length} device(s)</div>
      <div class="sceneActions">
        <button class="btnApply">Apply</button>
        <button class="btnDelete">Delete</button>
      </div>
    `;

    card.querySelector(".btnApply").addEventListener("click", async () => {
      for (const item of scene.items) {
        const device = devices.find(d => d.id === item.deviceId);
        if (!device) continue;
        await applyDeviceState(device, item.state);
      }
    });

    card.querySelector(".btnDelete").addEventListener("click", () => {
      scenes = scenes.filter(s => s.id !== scene.id);
      saveJSON(STORAGE_KEYS.SCENES, scenes);
      renderScenes();
    });

    sceneListEl.appendChild(card);
  });
}

/* ---------- Init ---------- */

function init() {
  renderDevices();
  renderDevicePicker();
  renderScenes();
}

init(); 
