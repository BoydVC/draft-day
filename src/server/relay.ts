export async function forwardIntake(entry: unknown): Promise<boolean> {
  const url = process.env.DD_WEBHOOK_URL;
  const key = process.env.DD_WEBHOOK_KEY;
  if (!url || !key) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(entry),
  });
  if (!response.ok) {
    throw new Error(`relay status ${response.status}`);
  }
  return true;
}
