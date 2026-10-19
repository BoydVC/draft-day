import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, stat, unlink, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DraftEvent } from "../core/events.ts";
import { formatPickId, isPickId, pickIdPrefix } from "../core/ids.ts";
import { followUpEvents, reduce } from "../core/reducer.ts";
import type { PickId } from "../core/types.ts";

const STALE_MS = 10_000;

interface LockBody {
  token?: unknown;
  pid?: unknown;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<{ body: LockBody | null; mtimeMs: number } | null> {
  try {
    const info = await stat(lockPath);
    const text = await readFile(lockPath, "utf8");
    try {
      const parsed = JSON.parse(text) as LockBody;
      return { body: parsed && typeof parsed === "object" ? parsed : null, mtimeMs: info.mtimeMs };
    } catch {
      return { body: null, mtimeMs: info.mtimeMs };
    }
  } catch {
    return null;
  }
}

function ownerPid(body: LockBody | null): number | null {
  return body && typeof body.pid === "number" ? body.pid : null;
}

function liveOwner(body: LockBody | null): boolean {
  const pid = ownerPid(body);
  return pid !== null && pidAlive(pid);
}

async function releaseOwned(lockPath: string, token: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(lockPath, "r");
    const text = await handle.readFile("utf8");
    const info = await handle.stat();
    const body = JSON.parse(text) as LockBody;
    if (body.token !== token) return;
    const current = await stat(lockPath);
    if (current.ino !== info.ino || current.dev !== info.dev) return;
    await unlink(lockPath);
  } catch {
    return;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function takeDead(lockPath: string): Promise<boolean> {
  const current = await readLock(lockPath);
  if (!current) return true;
  if (liveOwner(current.body)) return false;
  const pid = ownerPid(current.body);
  const dead = pid !== null && !pidAlive(pid);
  const corruptAndOld = pid === null && Date.now() - current.mtimeMs > STALE_MS;
  if (!dead && !corruptAndOld) return false;
  const again = await readLock(lockPath);
  if (!again) return true;
  if (liveOwner(again.body)) return false;
  if (again.body?.token !== current.body?.token) return false;
  await unlink(lockPath).catch(() => undefined);
  return true;
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomBytes(16).toString("hex");
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() }));
        return await fn();
      } finally {
        await handle.close().catch(() => undefined);
        await releaseOwned(lockPath, token);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (await takeDead(lockPath)) continue;
      if (Date.now() - started > 5_000) throw new Error(`lock timeout ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export function pickDir(dataDir: string, pickId: string): string {
  return join(dataDir, "picks", pickId);
}

export function eventsPath(dataDir: string, pickId: string): string {
  return join(pickDir(dataDir, pickId), "events.jsonl");
}

export async function listPickIds(dataDir: string): Promise<PickId[]> {
  const dir = join(dataDir, "picks");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter(isPickId).sort() as PickId[];
}

export async function readEvents(dataDir: string, pickId: string): Promise<DraftEvent[]> {
  let text = "";
  try {
    text = await readFile(eventsPath(dataDir, pickId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: DraftEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line) as DraftEvent);
  }
  return events;
}

export async function loadPicks(dataDir: string, now = Date.now()) {
  const ids = await listPickIds(dataDir);
  const picks = [];
  for (const id of ids) {
    const events = await readEvents(dataDir, id);
    if (events.length === 0) continue;
    const pick = reduce(events, now);
    if (pick) picks.push(pick);
  }
  return picks;
}

async function salvageEvents(dataDir: string, pickId: string): Promise<{ events: DraftEvent[]; torn: boolean }> {
  let text = "";
  try {
    text = await readFile(eventsPath(dataDir, pickId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], torn: false };
    throw error;
  }
  const events: DraftEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as DraftEvent);
    } catch {
      return { events, torn: true };
    }
  }
  return { events, torn: false };
}

export async function loadLogs(dataDir: string): Promise<{ pickId: string; events: readonly DraftEvent[] | null; torn?: boolean; prefix?: readonly DraftEvent[] }[]> {
  const ids = await listPickIds(dataDir);
  const logs: { pickId: string; events: readonly DraftEvent[] | null; torn?: boolean; prefix?: readonly DraftEvent[] }[] = [];
  for (const id of ids) {
    try {
      logs.push({ pickId: id, events: await readEvents(dataDir, id) });
    } catch {
    try {
      const salvaged = await salvageEvents(dataDir, id);
      logs.push({ pickId: id, events: salvaged.torn ? null : salvaged.events, torn: salvaged.torn, prefix: salvaged.events });
    } catch {
      logs.push({ pickId: id, events: null, torn: true });
    }
    }
  }
  return logs;
}

export async function allocatePickId(dataDir: string, now = new Date()): Promise<PickId> {
  await mkdir(dataDir, { recursive: true });
  return withLock(join(dataDir, "alloc.lock"), async () => {
    const ids = await listPickIds(dataDir);
    const prefix = pickIdPrefix(now);
    const seqs = ids.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(-2)));
    const id = formatPickId(now, Math.max(0, ...seqs) + 1);
    await mkdir(pickDir(dataDir, id), { recursive: true });
    return id;
  });
}

export async function commitPick(
  dataDir: string,
  pickId: string,
  build: (events: DraftEvent[]) => Omit<DraftEvent, "seq">[],
  now = Date.now(),
): Promise<{ events: DraftEvent[]; appended: number; noop: boolean }> {
  return withLock(join(pickDir(dataDir, pickId), "write.lock"), async () => {
    const existing = await readEvents(dataDir, pickId);
    const incoming = build(existing);
    if (incoming.length === 0) return { events: existing, appended: 0, noop: true };
    let seq = existing.reduce((max, event) => Math.max(max, event.seq), 0);
    const stamped: DraftEvent[] = incoming.map((event) => ({ ...event, seq: ++seq }));
    const follow = followUpEvents([...existing, ...stamped], now, stamped[0]?.ts ?? new Date(now).toISOString(), stamped[0]?.by ?? "dd");
    const novel = follow.filter((event) => !stamped.some((item) => item.type === event.type && item.key === event.key));
    const all = [...stamped, ...novel.map((event) => ({ ...event, seq: ++seq }))];
    await mkdir(pickDir(dataDir, pickId), { recursive: true });
    await appendFile(eventsPath(dataDir, pickId), all.map((event) => JSON.stringify(event)).join("\n") + "\n");
    return { events: [...existing, ...all], appended: all.length, noop: false };
  });
}

export async function signature(dataDir: string): Promise<string> {
  const ids = await listPickIds(dataDir);
  const parts: string[] = [];
  for (const id of ids) {
    try {
      const info = await stat(eventsPath(dataDir, id));
      parts.push(`${id}:${info.size}:${info.mtimeMs}`);
    } catch {
      parts.push(`${id}:0`);
    }
  }
  try {
    const inbox = await stat(join(dataDir, "intake.jsonl"));
    parts.push(`inbox:${inbox.size}:${inbox.mtimeMs}`);
  } catch {
    parts.push("inbox:0");
  }
  try {
    const ledger = await stat(join(dataDir, "ledger.jsonl"));
    parts.push(`ledger:${ledger.size}:${ledger.mtimeMs}`);
  } catch {
    parts.push("ledger:0");
  }
  return parts.join("|");
}
