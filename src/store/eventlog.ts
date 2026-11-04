import { mkdir, open, readdir, readFile, stat, unlink, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DraftEvent } from "../core/events.ts";
import { formatPickId, isPickId, pickIdPrefix } from "../core/ids.ts";
import { followUpEvents, reduce } from "../core/reducer.ts";
import type { PickId } from "../core/types.ts";

const STALE_MS = 10_000;

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
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

export async function loadLogs(dataDir: string): Promise<{ pickId: string; events: readonly DraftEvent[] | null }[]> {
  const ids = await listPickIds(dataDir);
  const logs: { pickId: string; events: readonly DraftEvent[] | null }[] = [];
  for (const id of ids) {
    try {
      logs.push({ pickId: id, events: await readEvents(dataDir, id) });
    } catch {
      logs.push({ pickId: id, events: null });
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
  return parts.join("|");
}
