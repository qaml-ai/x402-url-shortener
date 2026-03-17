import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { stripeApiKeyMiddleware } from "x402-stripe";
import { openapiFromMiddleware } from "x402-openapi";
import { nanoid } from "nanoid";

const app = new Hono<{ Bindings: Env }>();

const ROUTES = {
  "POST /": {
    accepts: [
      { scheme: "exact", price: "$0.001", network: "eip155:8453", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.001", network: "eip155:137", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.001", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "CvraJ4avKPpJNLvMhMH5ip2ihdt85PXvDwfzXdziUxRq" },
    ],
    description: "Shorten a URL. Send {\"url\": \"https://example.com/long/path\"}",
    mimeType: "application/json",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              url: { type: "string", description: "The URL to shorten", required: true },
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

app.use(stripeApiKeyMiddleware({ serviceName: "url-shortener" }));

app.use(async (c, next) => {
  if (c.get("skipX402")) return next();
  return cdpPaymentMiddleware((env) => ({
    "POST /": { ...ROUTES["POST /"], accepts: ROUTES["POST /"].accepts.map((a: any) => ({ ...a, payTo: a.network.startsWith("solana") ? a.payTo : env.SERVER_ADDRESS as `0x${string}` })) },
  }))(c, next);
});

app.post("/", async (c) => {
  const body = await c.req.json<{ url?: string }>();
  if (!body?.url) {
    return c.json({ error: "Missing 'url' field" }, 400);
  }
  const url = body.url.trim();

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
  return new Response('# link.camelai.io \\u2014 URL Shortener\n\nShorten URLs.\n\nPart of [camelai.io](https://camelai.io).\n\n## API\n\n\\`POST /\\` \\u2014 $0.001 per request\n\n**Body:** `{"url": "https://example.com/very/long/path"}`\n\n**Response:** JSON with short_url\n\n## Payment\n\nAccepts USDC on Base, Polygon, or Solana via x402. Or use a Stripe API key (\\`Authorization: Bearer sk_camel_...\\`).\n\nSee [camelai.io](https://camelai.io) for payment setup and full service list.', {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});

export default app;
