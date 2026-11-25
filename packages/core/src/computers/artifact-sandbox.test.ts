import { VISUAL_IMAGE_MAX_COUNT } from "@rakazo/contracts";
import { deferred } from "@rakazo/core/test-async";
import { describe, expect, it, vi } from "vitest";
import {
  createPageImageResponder,
  MAX_INLINE_VISUAL_HEIGHT,
  PAGE_COPY_MAX_LENGTH,
  pageCopyRequest,
  pageImageRequest,
  pageImageResult,
  pageLinkRequest,
  pageReplyText,
  pageViewerDocument,
  SANDBOXED_ARTIFACT_CSP,
  visualFit,
  withSandboxedArtifactCsp,
} from "./artifact-sandbox.js";

describe("withSandboxedArtifactCsp", () => {
  it("keeps a leading doctype ahead of the CSP meta tag", () => {
    const html = "<!doctype html><html><head></head><body>hi</body></html>";
    const wrapped = withSandboxedArtifactCsp(html);
    expect(wrapped.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    const metaAt = wrapped.indexOf('<meta http-equiv="Content-Security-Policy"');
    expect(metaAt).toBe("<!doctype html>".length);
    expect(wrapped.indexOf("<html>")).toBeGreaterThan(metaAt);
    expect(wrapped).toContain(SANDBOXED_ARTIFACT_CSP);
  });

  it("adds a standards-mode doctype when the fragment has none", () => {
    const wrapped = withSandboxedArtifactCsp("<p>content</p>");
    expect(wrapped.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(wrapped).toContain(SANDBOXED_ARTIFACT_CSP);
    expect(wrapped).toContain("default-src 'none'");
    expect(wrapped.endsWith("<p>content</p>")).toBe(true);
  });

  it("puts the CSP ahead of content that precedes a doctype", () => {
    const html = "<script>evil()</script><!doctype html>";
    expect(withSandboxedArtifactCsp(html).startsWith("<!DOCTYPE html><meta")).toBe(true);
  });

  it("allows no network loads, only inline and data content", () => {
    expect(SANDBOXED_ARTIFACT_CSP).toContain("img-src data:;");
    expect(SANDBOXED_ARTIFACT_CSP).toContain("font-src data:;");
    expect(SANDBOXED_ARTIFACT_CSP).toContain("form-action 'none'");
    // A page's own sound or video plays from embedded data or a blob it made, never a URL.
    expect(SANDBOXED_ARTIFACT_CSP).toContain("media-src data: blob:;");
    expect(SANDBOXED_ARTIFACT_CSP).not.toContain("https:");
    expect(SANDBOXED_ARTIFACT_CSP).not.toContain("http:");
  });

  it("does not insert the CSP tag inside a quoted doctype", () => {
    const html = '<!DOCTYPE html SYSTEM "x>y"><script>evil()</script>';
    const wrapped = withSandboxedArtifactCsp(html);
    expect(wrapped.startsWith("<!DOCTYPE html><meta")).toBe(true);
    expect(wrapped.endsWith(html)).toBe(true);
    expect(wrapped).not.toContain("x<meta");
  });

  it("does not splice the meta tag into a comment that looks like <head>", () => {
    const html = "<!-- <head> --><script>evil()</script>";
    const wrapped = withSandboxedArtifactCsp(html);
    expect(wrapped.startsWith("<!DOCTYPE html><meta")).toBe(true);
    expect(wrapped.endsWith(html)).toBe(true);
  });
});

describe("pageViewerDocument", () => {
  const base = { runtime: "", code: "", theme: "dark" as const, errorTitle: "x" };

  it("marks a touch screen, and offers replies only when the host has a composer for them", () => {
    expect(pageViewerDocument({ ...base, touch: true })).toContain("<html data-touch>");
    expect(pageViewerDocument({ ...base, reply: true, touch: true })).toContain(
      "<html data-touch data-reply>",
    );
    expect(pageViewerDocument(base)).toContain("<html><head>");
  });

  it("carries page code that tries to close its script as inert JSON", () => {
    const code =
      'const App = () => React.createElement(Text, null, "</script><script>steal()</script><!--");';
    const html = pageViewerDocument({
      runtime: "window.RakazoPage={mount(){}};",
      code,
      theme: "light",
      errorTitle: "Couldn't show",
    });
    const boot = html.slice(
      html.indexOf("RakazoPage.mount(") + "RakazoPage.mount(".length,
      -"</script></body></html>".length - 1,
    );
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain("<!--");
    expect(JSON.parse(boot)).toEqual({ code, theme: "light", errorTitle: "Couldn't show" });
    const ja = pageViewerDocument({ ...base, lang: "ja" });
    expect(JSON.parse(ja.match(/RakazoPage\.mount\((.*)\)<\/script>/)![1]!).lang).toBe("ja");
    // The reader's language is not the content's, so it never becomes the frame's lang or dir.
    expect(ja).toContain("<html><head>");
  });

  it("paints the host surface behind the page on screen and refuses anything but a hex colour", () => {
    expect(pageViewerDocument({ ...base, surface: "#1f1f1f" })).toContain(
      "<style>@media screen{:root[data-theme]{--background:#1f1f1f}}</style>",
    );
    const injected = pageViewerDocument({ ...base, surface: "red}</style><script>x()</script>" });
    expect(injected).not.toContain("<style>");
    expect(injected).not.toContain("x()");
  });

  it("marks a still preview, and only then", () => {
    expect(pageViewerDocument({ ...base, still: true })).toContain("<html data-still>");
    expect(pageViewerDocument(base)).not.toContain("data-still");
  });
});

describe("pageReplyText", () => {
  it("keeps a reply on one line, up to 300 characters", () => {
    expect(pageReplyText("  Pick\n\toption   B ")).toBe("Pick option B");
    expect(pageReplyText("x".repeat(300))).toHaveLength(300);
    for (const unusable of ["x".repeat(301), " \n ", 7, undefined]) {
      expect(pageReplyText(unusable)).toBeNull();
    }
  });
});

describe("pageCopyRequest", () => {
  it("passes a page's text to copy and nothing else, up to the cap", () => {
    const copy = { type: "rakazo-page:copy", id: "c1", text: "yes" };
    expect(pageCopyRequest(copy)).toEqual({ id: "c1", text: "yes" });
    const longest = "x".repeat(PAGE_COPY_MAX_LENGTH);
    expect(pageCopyRequest({ ...copy, text: longest })).toEqual({ id: "c1", text: longest });
    expect(pageCopyRequest({ ...copy, text: `${longest}x` })).toBeNull();
    expect(pageCopyRequest({ ...copy, text: "" })).toBeNull();
    expect(pageCopyRequest({ ...copy, text: 7 })).toBeNull();
    expect(pageCopyRequest({ ...copy, id: "" })).toBeNull();
    expect(pageCopyRequest({ ...copy, id: "i".repeat(65) })).toBeNull();
    expect(pageCopyRequest({ ...copy, type: "rakazo-page:paste" })).toBeNull();
    expect(pageCopyRequest("rakazo-page:copy")).toBeNull();
  });
});

describe("pageLinkRequest", () => {
  it("opens only web and mail links a page asks for", () => {
    const ask = (url: unknown, type = "rakazo-page:open-link") => ({ type, url });
    expect(pageLinkRequest(ask("https://example.com/a?b=1"))).toBe("https://example.com/a?b=1");
    expect(pageLinkRequest(ask("http://example.com"))).toBe("http://example.com/");
    expect(pageLinkRequest(ask("mailto:rj@example.com"))).toBe("mailto:rj@example.com");
    for (const refused of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///etc/passwd",
      "rakazo://settings",
      "intent://x#Intent;end",
      "/relative",
      `https://example.com/${"a".repeat(5000)}`,
      42,
    ]) {
      expect(pageLinkRequest(ask(refused))).toBeNull();
    }
    expect(pageLinkRequest(ask("https://example.com", "rakazo-page:other"))).toBeNull();
    expect(pageLinkRequest(null)).toBeNull();
  });
});

describe("createPageImageResponder", () => {
  it("downloads and answers once per id, with a hard limit per document", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const answer = vi.fn();
    const received = createPageImageResponder(load);
    const ids = Array.from({ length: VISUAL_IMAGE_MAX_COUNT + 1 }, (_, i) => ({ id: `art-${i}` }));
    const request = (id: string) => ({ type: "rakazo-page:image", id });
    expect(received(request("unknown"), ids, answer)).toBe(false);
    for (const { id } of ids) {
      expect(received(request(id), ids, answer)).toBe(true);
      expect(received(request(id), ids, answer)).toBe(true);
    }
    expect(load.mock.calls).toEqual(ids.slice(0, VISUAL_IMAGE_MAX_COUNT).map(({ id }) => [id]));
    pending.resolve("data:image/webp;base64,AA==");
    await pending.promise;
    received(request("art-0"), ids, answer);
    await pending.promise;
    expect(answer).toHaveBeenCalledTimes(VISUAL_IMAGE_MAX_COUNT);
    expect(answer).toHaveBeenCalledWith(pageImageResult("art-0", "data:image/webp;base64,AA=="));
    createPageImageResponder(load)(request("art-0"), ids, answer);
    expect(load).toHaveBeenCalledTimes(VISUAL_IMAGE_MAX_COUNT + 1);
  });
});

describe("pageImageRequest", () => {
  const carried = [
    { id: "art-1", alt: "Aeroblend box", size: 12_000 },
    { id: "art-2", alt: "Mixwell box", size: 9_000 },
  ];

  it("passes a picture id the message carries, and nothing else", () => {
    const ask = { type: "rakazo-page:image", id: "art-2" };
    expect(pageImageRequest(ask, carried)).toEqual({ id: "art-2" });
    // Only ids from the frame's own message answer: another message's, a guess, or no list at all.
    expect(pageImageRequest({ ...ask, id: "art-3" }, carried)).toBeNull();
    expect(pageImageRequest(ask, undefined)).toBeNull();
    expect(pageImageRequest(ask, [{ id: "other" }])).toBeNull();
  });

  it("refuses anything but a well-formed id, so a frame can never ask for a URL", () => {
    const ask = { type: "rakazo-page:image", id: "art-1" };
    expect(pageImageRequest({ ...ask, id: "" }, carried)).toBeNull();
    expect(pageImageRequest({ ...ask, id: "x".repeat(65) }, carried)).toBeNull();
    expect(
      pageImageRequest({ type: "rakazo-page:image", id: "https://evil.example/pixel" }, carried),
    ).toBeNull();
    expect(pageImageRequest({ type: "rakazo-page:open-link", id: "art-1" }, carried)).toBeNull();
    expect(pageImageRequest([ask], carried)).toBeNull();
    expect(pageImageRequest("rakazo-page:image", carried)).toBeNull();
    expect(pageImageRequest(null, carried)).toBeNull();
  });

  it("answers with the picture's bytes as a data URI, or null when it has none", () => {
    expect(pageImageResult("art-1", "data:image/webp;base64,UGs=")).toEqual({
      type: "rakazo-page:image-data",
      id: "art-1",
      src: "data:image/webp;base64,UGs=",
    });
    expect(pageImageResult("art-1", null)).toEqual({
      type: "rakazo-page:image-data",
      id: "art-1",
      src: null,
    });
  });
});

describe("visualFit", () => {
  it("works in the chat when it fits and previews when it is taller", () => {
    expect(visualFit("drawing", 320, 560)).toBe("inline");
    expect(visualFit("drawing", 560, 560)).toBe("inline");
    expect(visualFit("drawing", 1400, 560)).toBe("preview");
  });

  it("keeps a normal explainer in the chat and previews only a genuinely tall one", () => {
    const cap = MAX_INLINE_VISUAL_HEIGHT;
    expect(visualFit("drawing", 1000, cap)).toBe("inline");
    expect(visualFit("drawing", cap, cap)).toBe("inline");
    expect(visualFit("drawing", cap + 1, cap)).toBe("preview");
    expect(visualFit("drawing", 1800, cap)).toBe("inline");
    expect(visualFit("drawing", cap * 2, cap)).toBe("preview");
  });

  it("waits for a real height", () => {
    expect(visualFit("drawing", 0, 560)).toBe("drawing");
    expect(visualFit("drawing", Number.NaN, 560)).toBe("drawing");
  });

  it("keeps the first fit when the visual grows or shrinks later", () => {
    expect(visualFit("inline", 1400, 560)).toBe("inline");
    expect(visualFit("preview", 200, 560)).toBe("preview");
  });
});
