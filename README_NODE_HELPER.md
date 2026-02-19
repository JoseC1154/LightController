LightController — Node helper for network discovery

This helper runs locally on your machine (or a machine on the same LAN) and performs simple mDNS and SSDP discovery, exposing results over HTTP so the browser UI can fetch them.

Install

```bash
cd LightController
npm install
```

Run

```bash
npm start
```

Endpoints

- `GET /devices` — JSON array of discovered devices
- `POST /scan` — trigger an immediate SSDP scan
- `POST /clear` — clear discovered devices

Notes

- This is a local helper and should be run only on trusted networks.
- mDNS/SSDP discovery may require network permissions and works best on the same subnet as your devices.
