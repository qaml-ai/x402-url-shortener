import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { describeRoute, openAPIRouteHandler } from "hono-openapi";
import { nanoid } from "nanoid";

const app = new Hono<{ Bindings: Env }>();

// OpenAPI spec — must be before paymentMiddleware
app.get("/.well-known/openapi.json", openAPIRouteHandler(app, {
  documentation: {
    info: {
      title: "x402 URL Shortener",
      description: "Shorten URLs and redirect via short IDs. Pay-per-use via x402 protocol on Base mainnet.",
      version: "1.0.0",
    },
    servers: [{ url: "https://link.camelai.io" }],
  },
}));

// x402 payment gate on POST /shorten
app.use(
  cdpPaymentMiddleware(
    (env) => ({
      "POST /shorten": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:8453",
            payTo: env.SERVER_ADDRESS as `0x${string}`,
          },
        ],
        description: "Shorten a URL",
        mimeType: "application/json",
        extensions: {
          bazaar: {
            discoverable: true,
            inputSchema: {
              bodyFields: {
                url: {
                  type: "string",
                  description: "URL to shorten",
                  required: true,
                },
              },
            },
          },
        },
      },
    })
  )
);

// Paid endpoint: shorten a URL
app.post("/shorten", describeRoute({
  description: "Shorten a URL. Requires x402 payment ($0.001).",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "URL to shorten" },
          },
        },
      },
    },
  },
  responses: {
    200: { description: "Shortened URL", content: { "application/json": { schema: { type: "object" } } } },
    400: { description: "Missing or invalid URL" },
    402: { description: "Payment required" },
  },
}), async (c) => {
  const body = await c.req.json<{ url?: string }>();
  const url = body?.url;

  if (!url) {
    return c.json({ error: "Missing 'url' in request body" }, 400);
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
app.get("/:id", describeRoute({
  description: "Redirect to the original URL by short ID.",
  responses: {
    302: { description: "Redirect to original URL" },
    404: { description: "Short URL not found" },
  },
}), async (c) => {
  const id = c.req.param("id");
  const url = await c.env.URLS.get(id);

  if (!url) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.redirect(url, 302);
});

export default app;
