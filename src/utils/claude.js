const MODEL = "claude-sonnet-4-6";

// In dev, requests route through the Vite proxy to avoid CORS.
// In production (GitHub Pages), we call Anthropic directly using the
// official browser-access header they provide for client-side apps.
const BASE = import.meta.env.PROD
  ? "https://api.anthropic.com"
  : "/anthropic";

export async function claudePost(apiKey, { system, userContent, maxTokens = 1000 }) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      // Required for direct browser → Anthropic calls (production only; no-op in dev)
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  const tokenDelta =
    (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error(`Claude returned non-JSON: ${text.slice(0, 200)}`);
  }

  return { parsed, tokenDelta };
}
