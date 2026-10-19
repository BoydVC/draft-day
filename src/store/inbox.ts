import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DraftEvent } from "../core/events.ts";
import { listPickIds, readEvents, withLock } from "./eventlog.ts";

export interface InboxEntry {
  offset: number;
  ts: string;
  idea: string;
  source: string;
  target: string;
  n: number;
}

function inboxPath(dataDir: string): string {
  return join(dataDir, "intake.jsonl");
}

export async function readInbox(dataDir: string): Promise<InboxEntry[]> {
  let text = "";
  try {
    text = await readFile(inboxPath(dataDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: InboxEntry[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    offset += 1;
    const parsed = JSON.parse(line) as InboxEntry;
    entries.push({ ...parsed, offset });
  }
  return entries;
}

export async function appendInbox(
  dataDir: string,
  entry: Omit<InboxEntry, "offset">,
): Promise<InboxEntry> {
  await mkdir(dataDir, { recursive: true });
  return withLock(join(dataDir, "inbox.lock"), async () => {
    const existing = await readInbox(dataDir);
    const stored: InboxEntry = { ...entry, offset: existing.length + 1 };
    await appendFile(inboxPath(dataDir), JSON.stringify(stored) + "\n");
    return stored;
  });
}

export async function inboxCursor(dataDir: string): Promise<number> {
  const ids = await listPickIds(dataDir);
  let max = 0;
  for (const id of ids) {
    const events = await readEvents(dataDir, id);
    for (const event of events) {
      if (event.type === "pick_created" && typeof event.payload.inboxOffset === "number") {
        max = Math.max(max, event.payload.inboxOffset);
      }
    }
  }
  return max;
}

export function offsetOf(events: readonly DraftEvent[]): number {
  let max = 0;
  for (const event of events) {
    if (event.type === "pick_created" && typeof event.payload.inboxOffset === "number") {
      max = Math.max(max, event.payload.inboxOffset);
    }
  }
  return max;
}
