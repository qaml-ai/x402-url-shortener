import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { extractParams } from "x402-ai";
import { openapiFromMiddleware } from "x402-openapi";
import { nanoid } from "nanoid";

const app = new Hono<{ Bindings: Env }>();

const SYSTEM_PROMPT = `You are a parameter extractor for a URL shortening service.
Extract the following from the user's message and return JSON:
- "url": the URL to shorten (required)

Return ONLY valid JSON, no explanation.
Examples:
- {"url": "https://example.com/very/long/path/to/some/page"}
- {"url": "https://github.com/user/repo"}`;

const ROUTES = {
  "POST /": {
    accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:8453", payTo: "0x0" as `0x${string}` }],
    description: "Shorten a URL. Send {\"input\": \"your request\"}",
    mimeType: "application/json",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              input: { type: "string", description: "Provide the URL you want to shorten", required: true },
            },
          },
          output: { type: "json" },
        },
        schema: {
          properties: {
            input: {
              properties: { method: { type: "string", enum: ["POST"] } },
              required: ["method"],
            },
          },
        },
      },
    },
  },
};

app.use(
  cdpPaymentMiddleware((env) => ({
    "POST /": { ...ROUTES["POST /"], accepts: [{ ...ROUTES["POST /"].accepts[0], payTo: env.SERVER_ADDRESS as `0x${string}` }] },
  }))
);

app.post("/", async (c) => {
  const body = await c.req.json<{ input?: string }>();
  if (!body?.input) {
    return c.json({ error: "Missing 'input' field" }, 400);
  }

  const params = await extractParams(c.env.CF_GATEWAY_TOKEN, SYSTEM_PROMPT, body.input);
  const url = params.url as string;
  if (!url) {
    return c.json({ error: "Could not determine URL to shorten" }, 400);
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const id = nanoid(6);
  await c.env.URLS.put(id, url);

  const host = new URL(c.req.url).origin;
  return c.json({ short_url: `${host}/${id}`, id });
});

// Free endpoint: redirect by short ID
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const url = await c.env.URLS.get(id);

  if (!url) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.redirect(url, 302);
});

app.get("/.well-known/openapi.json", openapiFromMiddleware("x402 URL Shortener", "link.camelai.io", ROUTES));

app.get("/", (c) => {
  return c.json({
    service: "x402-url-shortener",
    description: "Shorten URLs and redirect via short IDs. Send POST / with {\"input\": \"shorten https://example.com/long/url\"}",
    price: "$0.001 per request (Base mainnet)",
  });
});

export default app;
