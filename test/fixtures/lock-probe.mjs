// A live owner's lock must not be stolen because its mtime is old, and only that owner may unlink.
import { mkdtemp, readFile, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { withLock } from "../../src/store/eventlog.ts";

const dir = await mkdtemp(join(tmpdir(), "dd-lock-"));
const lockPath = join(dir, "write.lock");
let inside = 0;
let maxInside = 0;
let aLeft = false;
let bEnteredDuringA = false;

let releaseA = () => {};
let markA = () => {};
const aEntered = new Promise((resolve) => {
  markA = resolve;
});
const a = withLock(lockPath, async () => {
  inside += 1;
  maxInside = Math.max(maxInside, inside);
  const past = new Date(Date.now() - 30_000);
  await utimes(lockPath, past, past);
  markA();
  await new Promise((resolve) => {
    releaseA = resolve;
  });
  inside -= 1;
  aLeft = true;
});
await aEntered;
const b = withLock(lockPath, async () => {
  if (!aLeft) bEnteredDuringA = true;
  inside += 1;
  maxInside = Math.max(maxInside, inside);
  inside -= 1;
});
await new Promise((resolve) => setTimeout(resolve, 400));
releaseA();
await a;
await b;

const ownerPath = join(dir, "owner.lock");
let releaseOwner = () => {};
let markOwner = () => {};
const ownerEntered = new Promise((resolve) => {
  markOwner = resolve;
});
const owner = withLock(ownerPath, async () => {
  markOwner();
  await new Promise((resolve) => {
    releaseOwner = resolve;
  });
});
await ownerEntered;
await unlink(ownerPath);
await writeFile(ownerPath, JSON.stringify({ token: "intruder", pid: process.pid, at: new Date().toISOString() }));
releaseOwner();
await owner;
const after = await readFile(ownerPath, "utf8");

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
const deadPid = child.pid;
child.kill("SIGKILL");
await new Promise((resolve) => child.once("exit", resolve));
const deadPath = join(dir, "dead.lock");
await writeFile(deadPath, JSON.stringify({ token: "dead", pid: deadPid, at: "2020-01-01T00:00:00.000Z" }));
const past = new Date(Date.now() - 30_000);
await utimes(deadPath, past, past);
let recovered = false;
await withLock(deadPath, async () => {
  recovered = true;
});

const problems = [];
if (maxInside !== 1) problems.push(`maxInside=${maxInside}`);
if (bEnteredDuringA) problems.push("waiter entered while the owner was inside");
if (!after.includes("intruder")) problems.push("owner unlinked a lock it does not own");
if (!recovered) problems.push("dead owner was not recovered");
if (problems.length) {
  console.error(problems.join("; "));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, maxInside, recovered: true }));
