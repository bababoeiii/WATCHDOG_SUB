import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Collector } from "../src/collect.js";

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "agent.js");
const run = (env, args = []) =>
  new Promise((resolve) =>
    execFile(process.execPath, [AGENT, ...args], { env: { ...process.env, WATCHDOG_ENV_FILE: "/nonexistent", ...env }, timeout: 15000 },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr })),
  );

test("a sample has the shape the main server expects", async () => {
  const c = new Collector();
  await c.init();
  const s = await c.collect();
  assert.equal(typeof s.cpu.percent, "number");
  assert.ok(s.cpu.percent >= 0 && s.cpu.percent <= 100);
  assert.ok(Array.isArray(s.cpu.per_core));
  assert.ok(s.mem.total > 0 && s.mem.percent >= 0 && s.mem.percent <= 100);
  assert.ok(Array.isArray(s.disks));
  for (const d of s.disks) assert.equal(typeof d.percent, "number");
  assert.ok(s.net.rx_rate >= 0 && s.net.tx_rate >= 0);
  assert.ok(s.uptime > 0 && s.boot_time > 1e9);
  assert.ok(s.temp === null || typeof s.temp.max === "number");
});

test("disk usage is cached between samples", async () => {
  const c = new Collector();
  await c.init();
  const a = await c.disks();
  assert.equal(await c.disks(), a); // same object: `df` didn't run again
});

test("bad settings stop the agent with a clear message", async () => {
  const bad = await run({ INTERVAL_SECONDS: "abc", MAIN_SERVER_URL: "http://x", AGENT_TOKEN: "wd_x" });
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /INTERVAL_SECONDS must be a number/);
  const missing = await run({ MAIN_SERVER_URL: "", AGENT_TOKEN: "" });
  assert.notEqual(missing.code, 0);
  assert.match(missing.out, /Set MAIN_SERVER_URL and AGENT_TOKEN/);
});

// ---- per-CPU temperatures from /sys/class/hwmon (a fake tree here)
import fs from "node:fs";
import os from "node:os";
import { readCpuSockets } from "../src/collect.js";

function fakeHwmon(devices) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwmon-"));
  devices.forEach((d, i) => {
    const dir = path.join(root, `hwmon${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "name"), `${d.name}\n`);
    for (const [k, v] of Object.entries(d.files || {})) fs.writeFileSync(path.join(dir, k), `${v}\n`);
    if (d.pci) {
      const target = path.join(root, "devices", d.pci);
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(target, path.join(dir, "device"));
    }
  });
  return root;
}

test("dual Intel CPUs: one temperature per package, in socket order", async () => {
  const root = fakeHwmon([
    { name: "nvme", files: { temp1_input: 41000 } },
    { name: "coretemp", files: { temp1_label: "Package id 1", temp1_input: 54000, temp2_label: "Core 0", temp2_input: 52000 } },
    { name: "coretemp", files: { temp1_label: "Package id 0", temp1_input: 61500, temp2_label: "Core 0", temp2_input: 60000 } },
  ]);
  assert.deepEqual(await readCpuSockets(root), [{ label: "CPU 1", current: 61.5 }, { label: "CPU 2", current: 54 }]);
  const t = await new Collector({ hwmonRoot: root }).temperatures();
  if (process.platform === "linux") {
    assert.deepEqual(t.cpus.map((c) => c.label), ["CPU 1", "CPU 2"]);
    assert.ok(t.max >= 61.5);
  }
});

test("dual AMD CPUs: Tdie (else Tctl) per k10temp, ordered by PCI address", async () => {
  const root = fakeHwmon([
    { name: "k10temp", pci: "0000:80:18.3", files: { temp1_label: "Tctl", temp1_input: 70000, temp2_label: "Tdie", temp2_input: 58000 } },
    { name: "k10temp", pci: "0000:00:18.3", files: { temp1_label: "Tctl", temp1_input: 63000 } },
  ]);
  assert.deepEqual(await readCpuSockets(root), [{ label: "CPU 1", current: 63 }, { label: "CPU 2", current: 58 }]);
});

test("one CPU, odd values or no sensors: nothing to split", async () => {
  assert.equal((await readCpuSockets(fakeHwmon([{ name: "coretemp", files: { temp1_label: "Package id 0", temp1_input: 50000 } }]))).length, 1);
  assert.deepEqual(await readCpuSockets(fakeHwmon([{ name: "coretemp", files: { temp1_label: "Package id 0", temp1_input: 0 } }])), []);
  assert.deepEqual(await readCpuSockets("/nonexistent"), []);
});
