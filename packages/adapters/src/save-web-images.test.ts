import { describe, expect, it, vi } from "vitest";
import { partitionTools } from "./builtin-tool-bridge.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { integrationTools } from "./run-tools-integrations.js";
import { postSavedWebImage, saveWebImages } from "./save-web-images.js";
import { rememberFetchedPageImage } from "./web-tools.js";

const attach = vi.hoisted(() => vi.fn());
const persist = vi.hoisted(() => vi.fn());

vi.mock("./thread-artifacts.js", () => ({
  attachWorkspaceFileToThread: attach,
}));

vi.mock("./run-messages.js", () => ({
  persistMessageInTransaction: persist,
  runLeaseFor: () => ({ attempt: 1 }),
}));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const FETCH_FIRST =
  "Fetch the page with web_fetch first. save_web_images only saves an image URL that fetch returned.";

const publicAddress = async (hostname: string) => [
  {
    address: hostname === "private.test" ? "10.1.1.1" : "203.0.113.10",
    family: 4 as const,
  },
];

function responseFor(url: string): Response {
  if (url.endsWith("/jump.png")) {
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/x.png" },
    });
  }
  if (url.endsWith("/huge.png")) {
    return new Response(PNG, {
      headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) },
    });
  }
  if (url.endsWith("/picture.svg")) {
    return new Response("<svg xmlns='http://www.w3.org/2000/svg'></svg>", {
      headers: { "content-type": "image/svg+xml" },
    });
  }
  if (url.endsWith("/page.html")) {
    return new Response("<p>not an image</p>", { headers: { "content-type": "text/html" } });
  }
  if (url.endsWith("/mismatch.png")) {
    return new Response(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), {
      headers: { "content-type": "image/png" },
    });
  }
  if (url.endsWith("/harbor.png")) {
    return new Response(PNG, { headers: { "content-type": "image/png; charset=binary" } });
  }
  if (url.endsWith("/coat.jpg")) {
    return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  }
  if (url.endsWith("/mark.webp")) {
    return new Response(WEBP, { headers: { "content-type": "image/webp" } });
  }
  if (url.endsWith("/mark.gif")) {
    return new Response(GIF, { headers: { "content-type": "image/gif" } });
  }
  return new Response("missing", { status: 404 });
}

function deps(siteAllowed: (url: string) => boolean = () => true) {
  const trusted = new Set([
    "https://cdn.example.test/harbor.png",
    "https://cdn.example.test/coat.jpg",
    "https://cdn.example.test/mark.webp",
    "https://cdn.example.test/mark.gif",
    "https://cdn.example.test/huge.png",
    "https://cdn.example.test/picture.svg",
    "https://cdn.example.test/page.html",
    "https://cdn.example.test/mismatch.png",
    "https://cdn.example.test/jump.png",
    "https://private.test/photo.png",
  ]);
  const saved: Array<{ mimeType: string; extension: string; caption: string; bytes: Uint8Array }> =
    [];
  const save = vi.fn(async (image: (typeof saved)[number]) => {
    saved.push(image);
    return { artifactId: `art-${saved.length}` };
  });
  const fetch = vi.fn(async (input: RequestInfo | URL) => responseFor(String(input)));
  return {
    trustedUrls: trusted,
    save,
    fetch,
    resolveHostname: publicAddress,
    siteAllowed,
    saved,
  };
}

describe("rememberFetchedPageImage", () => {
  it("records an https image and the first page that named it", () => {
    const urls = new Map<string, string>();
    rememberFetchedPageImage(
      urls,
      "https://CDN.Example.Test/ferry.jpg",
      "https://www.space.com/story",
    );
    rememberFetchedPageImage(urls, "https://cdn.example.test/ferry.jpg", "https://nasa.gov/later");
    rememberFetchedPageImage(urls, "http://cdn.example.test/ferry.jpg", "https://nasa.gov/x");
    rememberFetchedPageImage(urls, "javascript:alert(1)", "https://nasa.gov/x");
    rememberFetchedPageImage(urls, "data:image/png;base64,aaaa", "https://nasa.gov/x");
    rememberFetchedPageImage(urls, 12, "https://nasa.gov/x");
    expect([...urls]).toEqual([
      ["https://cdn.example.test/ferry.jpg", "https://www.space.com/story"],
    ]);
  });
});

describe("saveWebImages", () => {
  it("rejects an image the fetch did not return, before any request", async () => {
    const options = deps();
    const result = await saveWebImages(
      { images: [{ url: "https://evil.example.test/a.png", caption: "Nope" }] },
      options,
    );
    expect(result).toEqual({ images: [{ error: FETCH_FIRST }] });
    expect(options.fetch).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
  });

  it("rejects a private host, a private redirect, a wrong type, a bad signature, SVG and an oversized body", async () => {
    const options = deps();
    const result = await saveWebImages(
      {
        images: [
          { url: "https://private.test/photo.png", caption: "Private" },
          { url: "https://cdn.example.test/jump.png", caption: "Redirect" },
          { url: "https://cdn.example.test/page.html", caption: "Page" },
          { url: "https://cdn.example.test/mismatch.png", caption: "Mismatch" },
          { url: "https://cdn.example.test/picture.svg", caption: "Drawing" },
          { url: "https://cdn.example.test/huge.png", caption: "Huge" },
        ],
      },
      options,
    );
    expect(result).toEqual({
      images: [
        { error: "URL resolves to a private address" },
        { error: "URL targets a private or internal host" },
        { error: "Only PNG, JPEG, WebP and GIF images can be saved." },
        { error: "Only PNG, JPEG, WebP and GIF images can be saved." },
        { error: "SVG images are not saved." },
        { error: "Response is too large" },
      ],
    });
    expect(options.save).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalledWith(
      "https://private.test/photo.png",
      expect.anything(),
    );
  });

  it("does not fetch when the site gate refuses", async () => {
    const options = deps(() => false);
    const result = await saveWebImages(
      { images: [{ url: "https://cdn.example.test/harbor.png", caption: "Harbor" }] },
      options,
    );
    expect(result).toEqual({
      images: [{ error: "That site is not approved for this run, so its image was not fetched." }],
    });
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it("stores allowed images and returns their embed lines in order", async () => {
    const options = deps();
    const result = await saveWebImages(
      {
        images: [
          { url: "https://cdn.example.test/harbor.png", caption: "  Harbor   ferry " },
          { url: "https://evil.example.test/no.png", caption: "Skipped" },
          { url: "https://cdn.example.test/coat.jpg", caption: "Wool coat" },
          { url: "https://cdn.example.test/mark.webp", caption: "WebP" },
          { url: "https://cdn.example.test/mark.gif", caption: "Gif" },
        ],
      },
      options,
    );
    expect(result).toEqual({
      images: [
        { embed: "![Harbor ferry](image:art-1)" },
        { error: FETCH_FIRST },
        { embed: "![Wool coat](image:art-2)" },
        { embed: "![WebP](image:art-3)" },
        { embed: "![Gif](image:art-4)" },
      ],
    });
    expect(options.save).toHaveBeenCalledTimes(4);
    expect(options.saved[0]).toMatchObject({
      mimeType: "image/png",
      extension: "png",
      caption: "Harbor ferry",
      bytes: PNG,
    });
    expect(options.saved[1]).toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
    expect(options.saved[0]).not.toHaveProperty("source");
  });

  it("passes the page a fetched image came from", async () => {
    const options = deps();
    const pages = new Map<string, string>([
      ["https://cdn.example.test/harbor.png", "https://www.space.com/harbor"],
    ]);
    const result = await saveWebImages(
      { images: [{ url: "https://cdn.example.test/harbor.png", caption: "Harbor" }] },
      { ...options, trustedUrls: pages },
    );
    expect(result).toEqual({ images: [{ embed: "![Harbor](image:art-1)" }] });
    expect(options.saved[0]).toMatchObject({
      source: { url: "https://www.space.com/harbor", site: "space" },
    });
  });

  it("rejects a bad list before fetching", async () => {
    const options = deps();
    await expect(saveWebImages({}, options)).resolves.toEqual({
      error: "images must be a list of {url, caption}.",
    });
    await expect(saveWebImages({ images: [] }, options)).resolves.toEqual({
      error: "Pass at least one image.",
    });
    await expect(
      saveWebImages(
        {
          images: Array.from({ length: 7 }, () => ({
            url: "https://cdn.example.test/a.png",
            caption: "A",
          })),
        },
        options,
      ),
    ).resolves.toEqual({ error: "Save at most 6 images at a time." });
    await expect(
      saveWebImages({ images: [{ url: "https://cdn.example.test/harbor.png" }] }, options),
    ).resolves.toEqual({ images: [{ error: "caption is required" }] });
    expect(options.fetch).not.toHaveBeenCalled();
  });
});

describe("save_web_images offer", () => {
  const base = {
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "message",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const names = (extra = {}) =>
    selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);

  it("is offered only when image storage is configured, and never on a background run", () => {
    expect(names()).not.toContain("save_web_images");
    expect(names({ webImagesEnabled: true })).toContain("save_web_images");
    expect(names({ trigger: "tickets", webImagesEnabled: true })).not.toContain("save_web_images");
    expect(
      names({ webImagesEnabled: true, disabledBuiltinTools: ["save_web_images"] }),
    ).not.toContain("save_web_images");
    const offered = selectBuiltinToolsForRun({ ...base, webImagesEnabled: true });
    const parts = partitionTools(offered);
    expect(parts.listed.map((tool) => tool.name)).not.toContain("save_web_images");
    expect(parts.deferred.map((tool) => tool.name)).toContain("save_web_images");
    expect(parts.listed.find((tool) => tool.name === "find_tool")?.description).toContain(
      "save_web_images",
    );
  });

  it("is not offered, and refuses, when storage is missing", async () => {
    const saveWebImagesTool = integrationTools.save_web_images;
    if (!saveWebImagesTool) throw new Error("save_web_images is missing");
    const finish = (value: unknown) => value;
    await expect(
      saveWebImagesTool(
        { deps: {}, run: { trigger: "user" } } as unknown as RunContext,
        { args: { images: [] }, finish } as unknown as ToolCall,
      ),
    ).resolves.toEqual({ error: "Image storage is not configured." });
    await expect(
      saveWebImagesTool(
        { deps: { artifacts: {} }, run: { trigger: "tickets" } } as unknown as RunContext,
        { args: { images: [] }, finish } as unknown as ToolCall,
      ),
    ).resolves.toEqual({ error: "Images are not saved on a background run." });
  });
});

describe("postSavedWebImage", () => {
  it("stores the image and posts it as its own message", async () => {
    attach.mockImplementation(
      async (
        _deps: unknown,
        input: {
          onAttached: (
            tx: unknown,
            artifact: { id: string; name: string; mimeType: string; size: number },
          ) => Promise<void>;
          name: string;
          bytes: Uint8Array;
        },
      ) => {
        await input.onAttached(
          {},
          {
            id: "art-posted",
            name: input.name,
            mimeType: "image/png",
            size: input.bytes.byteLength,
          },
        );
        return { artifactId: "art-posted" };
      },
    );
    persist.mockResolvedValue({ eventSeq: 4, firstResponseRunId: "run-1" });
    const notify = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      deps: {
        artifacts: { id: "store" },
        prisma: {},
        events: { notify },
      },
      run: {
        id: "run-1",
        spaceId: "space",
        userId: "user",
        threadId: "thread",
        botId: "bot",
        trigger: "user",
      },
      bot: { id: "bot" },
      thread: { groupId: "group" },
    } as unknown as RunContext;

    await expect(
      postSavedWebImage(ctx, { executionId: "exec-1" } as ToolCall, {
        bytes: PNG,
        mimeType: "image/png",
        extension: "png",
        caption: "Harbor ferry",
      }),
    ).resolves.toEqual({ artifactId: "art-posted" });

    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ artifacts: { id: "store" } }),
      expect.objectContaining({
        filePath: "web-image.png",
        name: "Harbor ferry",
        bytes: PNG,
        operationId: "exec-1",
        runId: "run-1",
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      {},
      ctx.run,
      "bot",
      [{ kind: "image", artifactId: "art-posted", mimeType: "image/png", name: "Harbor ferry" }],
      undefined,
      undefined,
      false,
      { attempt: 1 },
    );
    expect(notify).toHaveBeenCalledWith("thread", 4, "run-1");

    await postSavedWebImage(ctx, { executionId: "exec-1" } as ToolCall, {
      bytes: PNG,
      mimeType: "image/png",
      extension: "png",
      caption: "Harbor ferry",
      source: { url: "https://www.space.com/harbor", site: "space" },
    });
    expect(persist).toHaveBeenLastCalledWith(
      {},
      ctx.run,
      "bot",
      [
        {
          kind: "image",
          artifactId: "art-posted",
          mimeType: "image/png",
          name: "Harbor ferry",
          source: { url: "https://www.space.com/harbor", site: "space" },
        },
      ],
      undefined,
      undefined,
      false,
      { attempt: 1 },
    );
  });
});
