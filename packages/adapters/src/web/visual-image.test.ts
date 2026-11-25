import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResolveHostname } from "../network/network-address.js";
import { encodeVisualImage, fetchVisualImage } from "./visual-image.js";

type Reply = { status?: number; headers?: Record<string, string>; body?: Uint8Array | string };

// One local server stands in for every site. The injected fetch sends each request to it with
// the site's host in a header, so the SSRF checks still see the public-looking test hostnames.
const routes = new Map<string, Reply>();
const hits: string[] = [];
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (!request.headers["x-test-host"]) {
      response.writeHead(404).end();
      return;
    }
    const key = `${request.headers["x-test-host"]}${request.url}`;
    hits.push(key);
    const route = routes.get(key);
    response.writeHead(route ? (route.status ?? 200) : 404, route?.headers ?? {});
    response.end(route?.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  routes.clear();
  hits.length = 0;
});

const testFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const headers = { ...Object.fromEntries(new Headers(init?.headers)), "x-test-host": url.host };
  const { dispatcher: _dispatcher, ...rest } = (init ?? {}) as RequestInit & {
    dispatcher?: unknown;
  };
  return (await undiciFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
    ...(rest as object),
    headers,
  })) as unknown as Response;
};

const publicResolver: ResolveHostname = async () => [{ address: "203.0.113.10", family: 4 }];

async function png(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

const IMAGE = "https://shop.example.com/photo.png";

describe("fetchVisualImage", () => {
  it("keeps a fetched raster picture, downscaled to the chat's longest edge", async () => {
    routes.set("shop.example.com/photo.png", { body: await png(2000, 1500) });
    const resolved = await fetchVisualImage(IMAGE, {
      fetch: testFetch,
      resolveHostname: publicResolver,
    });
    const decoded = sharp(resolved.bytes);
    const meta = await decoded.metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(800);
    expect(resolved.bytes.byteLength).toBeLessThan(200 * 1024);
  });

  it("refuses a private address before any request is made", async () => {
    const privateResolver: ResolveHostname = async () => [{ address: "10.0.0.5", family: 4 }];
    await expect(
      fetchVisualImage(IMAGE, { fetch: testFetch, resolveHostname: privateResolver }),
    ).rejects.toThrow(/private/i);
    expect(hits).toEqual([]);
  });

  it("refuses anything but ports 80 and 443", async () => {
    await expect(
      fetchVisualImage("https://shop.example.com:8443/photo.png", {
        fetch: testFetch,
        resolveHostname: publicResolver,
      }),
    ).rejects.toThrow(/port/i);
    expect(hits).toEqual([]);
  });

  it("refuses bytes that are not a raster image, whatever the server declares", async () => {
    routes.set("shop.example.com/page", {
      headers: { "content-type": "image/png" },
      body: "<html><body>a page posing as a picture</body></html>",
    });
    await expect(
      fetchVisualImage("https://shop.example.com/page", {
        fetch: testFetch,
        resolveHostname: publicResolver,
      }),
    ).rejects.toThrow(/not a usable raster image/i);
  });

  it("refuses a picture over the byte cap before reading it", async () => {
    routes.set("shop.example.com/big.png", {
      body: new Uint8Array(5 * 1024 * 1024 + 1),
    });
    await expect(
      fetchVisualImage("https://shop.example.com/big.png", {
        fetch: testFetch,
        resolveHostname: publicResolver,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("follows a redirect to the picture, and stops after the bounded hops", async () => {
    routes.set("shop.example.com/moved", {
      status: 302,
      headers: { location: "https://cdn.example.com/photo.png" },
    });
    routes.set("cdn.example.com/photo.png", { body: await png(400, 300) });
    const resolved = await fetchVisualImage("https://shop.example.com/moved", {
      fetch: testFetch,
      resolveHostname: publicResolver,
    });
    expect((await sharp(resolved.bytes).metadata()).format).toBe("webp");
    const loop: Reply = {
      status: 302,
      headers: { location: "https://shop.example.com/loop" },
    };
    routes.set("shop.example.com/loop", loop);
    await expect(
      fetchVisualImage("https://shop.example.com/loop", {
        fetch: testFetch,
        resolveHostname: publicResolver,
      }),
    ).rejects.toThrow(/redirect/i);
  });
});

describe("encodeVisualImage", () => {
  it("keeps a small picture's own size and refuses one over the input pixel limit", async () => {
    const small = await encodeVisualImage(await png(320, 200));
    expect(small).not.toBeNull();
    const meta = await sharp(small!.bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(320);

    const square = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    // The limit is four megapixels: a 1024-square picture passes and is downscaled.
    const kept = await encodeVisualImage(square);
    expect(kept).not.toBeNull();
    const keptMeta = await sharp(kept!.bytes).metadata();
    expect(Math.max(keptMeta.width ?? 0, keptMeta.height ?? 0)).toBe(800);

    const huge = await sharp({
      create: {
        width: 3000,
        height: 3000,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    expect(await encodeVisualImage(huge)).toBeNull();
  });

  it("refuses an SVG or an empty body without decoding anything", async () => {
    expect(await encodeVisualImage(new TextEncoder().encode("<svg><script/>svg</svg>"))).toBeNull();
    expect(await encodeVisualImage(new Uint8Array(0))).toBeNull();
  });
});
