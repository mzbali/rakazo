import { MessageBlock, VISUAL_CODE_MAX_BYTES } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.fn();
vi.mock("./runs/assembly/run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./runs/assembly/run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

// The images path reads the run's taint state and trust loaders; both are controlled per test.
let runTainted = false;
vi.mock("./runs/assembly/run-context.js", async (importActual) => ({
  ...(await importActual<typeof import("./runs/assembly/run-context.js")>()),
  isRunTainted: () => Promise.resolve(runTainted),
}));

const fetchVisualImage = vi.fn();
vi.mock("./web/visual-image.js", async (importActual) => ({
  ...(await importActual<typeof import("./web/visual-image.js")>()),
  fetchVisualImage: (...args: unknown[]) => fetchVisualImage(...args),
}));

const storeVisualImage = vi.fn();
vi.mock("./storage/thread-artifacts.js", async (importActual) => ({
  ...(await importActual<typeof import("./storage/thread-artifacts.js")>()),
  storeVisualImage: (...args: unknown[]) => storeVisualImage(...args),
}));

const { visualTools } = await import("./run-tools-visuals.js");
const { redactBlocks } = await import("./runs/assembly/run-messages.js");

const FLOW = [
  "const Flow = () => (",
  '  <Diagram direction="horizontal" nodes={[{ id: "a", label: "Your message" }, { id: "b", label: "Bot reply" }]} edges={[{ from: "a", to: "b" }]} />',
  ");",
  "export default Flow;",
].join("\n");

const PRODUCTS = [
  "const Picks = () => (",
  '  <CardGrid label="Blenders">',
  '    <ProductCard title="Aeroblend" price="$49" image="rakazo-image:1" href="https://shop.example.com/a" />',
  '    <ProductCard title="Mixwell" price="$59" image="rakazo-image:2" href="https://shop.example.com/b" />',
  "  </CardGrid>",
  ");",
  "export default Picks;",
].join("\n");

const IMAGES = [
  { url: "https://cdn.example.com/aeroblend.png", alt: "Aeroblend box" },
  { url: "https://cdn.example.com/mixwell.png", alt: "Mixwell box" },
];

const context = (secrets: string[] = [], extra: Record<string, unknown> = {}) =>
  ({
    deps: { artifacts: {}, prisma: {} },
    context: { signal: new AbortController().signal },
    run: {
      id: "run-1",
      spaceId: "space-1",
      threadId: "t-1",
      botId: "bot-1",
      trigger: "user",
      userId: "user-1",
    },
    bot: { id: "bot-1" },
    thread: { id: "t-1", groupId: null },
    runId: "run-1",
    secrets,
    trust: {
      searchResultUrls: new Set<string>(),
      pageImageUrls: new Map<string, string>(),
      loadApprovalRules: async () => [],
      loadTrustedSites: async () => new Set<string>(),
    },
    ...extra,
  }) as never;

const call = (args: Record<string, unknown>) =>
  ({ args, executionId: "exec-1", finish: (result: unknown) => result }) as never;

const show = (args: Record<string, unknown>, secrets?: string[], extra?: Record<string, unknown>) =>
  visualTools.show_visual!(context(secrets, extra), call(args)) as Promise<Record<string, unknown>>;

/** The block the tool would post, as the publish call received it. */
function postedBlock() {
  const [, , , blocks] = publishMessage.mock.calls[0]!;
  return blocks[0] as Record<string, unknown>;
}

describe("show_visual", () => {
  beforeEach(() => {
    publishMessage.mockReset();
    publishMessage.mockResolvedValue({ id: "message-1" });
    fetchVisualImage.mockReset();
    storeVisualImage.mockReset();
    runTainted = false;
  });

  it("posts the checked, compiled visual with its summary as its own message", async () => {
    const result = await show({
      title: "Message\nflow",
      summary: "  Your message goes to the bot,\nwhich replies. ",
      source: FLOW,
    });
    expect(result).toMatchObject({
      shown: true,
      embed: "![Message flow](visual:message-1)",
    });
    expect(publishMessage).toHaveBeenCalledTimes(1);
    const [, , role, blocks] = publishMessage.mock.calls[0]!;
    expect(role).toBe("bot");
    expect(blocks).toEqual([
      {
        kind: "visual",
        title: "Message flow",
        text: "Your message goes to the bot, which replies.",
        code: expect.stringContaining("Your message"),
      },
    ]);
    // What clients receive parses as a message block.
    expect(MessageBlock.safeParse(blocks[0]).success).toBe(true);
  });

  it("says nothing was shown when the run's messages are not published", async () => {
    publishMessage.mockResolvedValueOnce(null);
    const result = await show({ title: "Flow", summary: "A to B.", source: FLOW });
    expect(result.shown).toBeUndefined();
    expect(result.error).toMatch(/nothing was shown/);
  });

  it("returns the guide for help without posting anything", async () => {
    const result = await show({ help: true });
    expect(result.guide).toMatch(/^# Visuals/);
    expect(result.guide).toContain("Diagram {nodes");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses a missing title or summary and a source the page check rejects", async () => {
    expect((await show({ summary: "x", source: FLOW })).error).toMatch(/title/);
    expect((await show({ title: "Flow", source: FLOW })).error).toMatch(/summary/);
    expect((await show({ title: "Flow", summary: "x".repeat(501), source: FLOW })).error).toMatch(
      /summary/,
    );
    const rejected = await show({
      title: "Flow",
      summary: "x",
      source: "export default () => <script>alert(1)</script>;",
    });
    expect(rejected.error).toMatch(/problems/);
    expect(rejected.problems).toEqual(expect.arrayContaining([expect.stringMatching(/script/)]));
    expect(rejected.patterns).toContain("Venn nested");
    expect(rejected.patterns).not.toMatch(/^# Pages/);
    const missingSource = await show({ title: "Flow", summary: "x", source: "  " });
    expect(missingSource.patterns).toContain("Venn nested");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses compiled code over the visual limit and points to a page", async () => {
    const rows = Array.from({ length: 3000 }, (_, index) => `["row ${index}", ${index}]`).join(",");
    const source = `const Big = () => <Table columns={["Name", "Value"]} rows={[${rows}]} />;\nexport default Big;`;
    const result = await show({ title: "Big", summary: "Many rows.", source });
    expect(result.error).toContain(`limit is ${VISUAL_CODE_MAX_BYTES}`);
    expect(result.error).toContain("save_page");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("never shows a secret, wherever it appears", async () => {
    const secret = "sk-test-0123456789abcdef";
    for (const args of [
      { title: `Key ${secret}`, summary: "x", source: FLOW },
      { title: "Flow", summary: `The key is ${secret}.`, source: FLOW },
      { title: "Flow", summary: "x", source: FLOW.replace("Bot reply", secret) },
      {
        title: "Flow",
        summary: "x",
        source: PRODUCTS,
        images: [{ url: `https://cdn.example.com/x.png?key=${secret}`, alt: "X" }, IMAGES[1]],
      },
      {
        title: "Flow",
        summary: "x",
        source: PRODUCTS,
        images: [
          { url: "https://cdn.example.com/x.png", alt: secret },
          { url: "https://cdn.example.com/y.png", alt: "Y" },
        ],
      },
    ]) {
      expect((await show(args, [secret])).error).toMatch(/secret/);
    }
    expect(fetchVisualImage).not.toHaveBeenCalled();
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("redacts a visual's title and summary when its message is published", () => {
    const [block] = redactBlocks(
      [{ kind: "visual", title: "token abc123", text: "uses abc123", code: "x" }],
      ["abc123"],
    );
    expect(block).toMatchObject({ kind: "visual", code: "x" });
    expect(JSON.stringify(block)).not.toContain("abc123");
  });

  it("redacts the alt text of a visual's pictures too", () => {
    const [block] = redactBlocks(
      [
        {
          kind: "visual",
          title: "Picks",
          text: "x",
          code: "x",
          images: [{ id: "art-1", alt: "token abc123", size: 3 }],
        },
      ],
      ["abc123"],
    );
    expect(JSON.stringify(block)).not.toContain("abc123");
  });

  describe("with images", () => {
    const fetchesPictures = () => {
      fetchVisualImage.mockImplementation(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
      }));
      storeVisualImage.mockImplementation(async () => "artifact-1");
    };

    it("fetches the named pictures and ships ids, alt text and sizes, never bytes or urls", async () => {
      fetchesPictures();
      storeVisualImage.mockReset();
      storeVisualImage.mockImplementation(async () => "artifact-1");
      const result = await show({
        title: "Picks",
        summary: "Two blenders.",
        source: PRODUCTS,
        images: IMAGES,
      });
      expect(result.shown).toBe(true);
      expect(publishMessage).toHaveBeenCalledTimes(1);
      const block = postedBlock();
      expect(block.code).toContain('image: "rakazo-image:artifact-1"');
      expect(block.code).not.toContain("rakazo-image:1");
      expect(JSON.stringify(block)).not.toContain("cdn.example.com");
      expect(block.images).toEqual([
        { id: "artifact-1", alt: "Aeroblend box", size: 3 },
        { id: "artifact-1", alt: "Mixwell box", size: 3 },
      ]);
      expect(MessageBlock.safeParse(block).success).toBe(true);
      // Stored under the thread's own space, bot and run, with the call's execution id.
      const [deps, owner] = storeVisualImage.mock.calls[0]!;
      expect(deps).toMatchObject({ prisma: {}, artifacts: {} });
      expect(owner).toMatchObject({
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
        runId: "run-1",
        operationId: "exec-1",
      });
    });

    it("names the picture that failed and shows nothing, even when others loaded", async () => {
      fetchesPictures();
      fetchVisualImage.mockRejectedValueOnce(new Error("Request failed: HTTP 404"));
      const result = await show({
        title: "Picks",
        summary: "Two blenders.",
        source: PRODUCTS,
        images: IMAGES,
      });
      expect(result.shown).toBeUndefined();
      expect(result.error).toContain("rakazo-image:1");
      expect(result.error).toContain("HTTP 404");
      expect(result.error).toContain("Nothing was shown");
      expect(publishMessage).not.toHaveBeenCalled();
      expect(storeVisualImage).not.toHaveBeenCalled();
    });

    it("refuses a picture the source names but images does not carry", async () => {
      const result = await show({
        title: "Picks",
        summary: "Two blenders.",
        source: PRODUCTS,
        images: IMAGES.slice(0, 1),
      });
      expect(result.error).toContain("rakazo-image:2");
      expect(fetchVisualImage).not.toHaveBeenCalled();
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("refuses a malformed or zero picture reference", async () => {
      const malformed = await show({
        title: "Picks",
        summary: "x.",
        source: PRODUCTS.replace('image="rakazo-image:1"', 'image="rakazo-image:1.webp"'),
        images: IMAGES,
      });
      expect(malformed.error).toMatch(/rakazo-image:/);
      const zero = await show({
        title: "Picks",
        summary: "x.",
        source: PRODUCTS.replace('image="rakazo-image:1"', 'image="rakazo-image:0"'),
        images: IMAGES,
      });
      expect(zero.error).toContain("rakazo-image:0");
      expect(zero.error).toContain("Number pictures from 1");
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("refuses images the source never shows, rather than dropping them silently", async () => {
      const result = await show({
        title: "Picks",
        summary: "Two blenders.",
        source: FLOW,
        images: IMAGES,
      });
      expect(result.error).toMatch(/shows no picture/);
      expect(fetchVisualImage).not.toHaveBeenCalled();
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("refuses more pictures than the visual may carry, and a bad images list", async () => {
      const many = IMAGES.concat([
        { url: "https://cdn.example.com/c.png", alt: "C" },
        { url: "https://cdn.example.com/d.png", alt: "D" },
        { url: "https://cdn.example.com/e.png", alt: "E" },
      ]);
      const result = await show({ title: "Picks", summary: "x.", source: PRODUCTS, images: many });
      expect(result.error).toMatch(/at most 4 images/i);
      const shape = await show({ title: "Picks", summary: "x.", source: PRODUCTS, images: "nope" });
      expect(shape.error).toMatch(/list of \{url, alt\}/);
      const missingAlt = await show({
        title: "Picks",
        summary: "x.",
        source: PRODUCTS,
        images: [{ url: "https://cdn.example.com/a.png" }],
      });
      expect(missingAlt.error).toMatch(/needs alt text/);
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("refuses a background run's pictures, and a run with no artifact storage", async () => {
      const background = await show(
        { title: "Picks", summary: "x.", source: PRODUCTS, images: IMAGES },
        [],
        {
          run: {
            id: "run-1",
            spaceId: "space-1",
            threadId: "t-1",
            botId: "bot-1",
            trigger: "tickets",
            userId: "user-1",
          },
        },
      );
      expect(background.error).toMatch(/background run/i);
      const unconfigured = await show(
        { title: "Picks", summary: "x.", source: PRODUCTS, images: IMAGES },
        [],
        { deps: {} },
      );
      expect(unconfigured.error).toMatch(/Image storage is not configured/);
      expect(fetchVisualImage).not.toHaveBeenCalled();
      expect(publishMessage).not.toHaveBeenCalled();
    });

    it("refuses a tainted run's picture on a site it was not given, and allows one it was", async () => {
      runTainted = true;
      fetchesPictures();
      const refused = await show({
        title: "Picks",
        summary: "Two blenders.",
        source: PRODUCTS,
        images: IMAGES,
      });
      expect(refused.error).toContain("rakazo-image:1");
      expect(refused.error).toMatch(/not approved for this run/);
      expect(fetchVisualImage).not.toHaveBeenCalled();

      // A site is its registrable domain, as it is for a fetch the owner approved.
      const trusted = await show(
        { title: "Picks", summary: "Two blenders.", source: PRODUCTS, images: IMAGES },
        [],
        {
          trust: {
            searchResultUrls: new Set(["https://cdn.example.com/aeroblend.png"]),
            pageImageUrls: new Map(),
            loadApprovalRules: async () => [],
            loadTrustedSites: async () => new Set(["example.com"]),
          },
        },
      );
      expect(trusted.shown).toBe(true);
      expect(publishMessage).toHaveBeenCalledTimes(1);
    });
  });
});
