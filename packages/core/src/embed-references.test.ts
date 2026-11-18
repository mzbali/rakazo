import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { EmbedFoldMessage } from "./embed-references.js";
import {
  embedLine,
  embedReferencesIn,
  embedTarget,
  placedEmbedMessages,
  plainEmbedReferences,
} from "./embed-references.js";
import { plainTextFromMarkdown } from "./messages/markdown-plain.js";
import { visibleTextFromMarkdown } from "./messages/message-quote.js";
import { copyableMessageText } from "./messages/message-text.js";

function row(
  id: string,
  blocks: MessageBlock[],
  extra: { role?: string; runId?: string } = {},
): EmbedFoldMessage {
  return { id, role: extra.role ?? "bot", runId: extra.runId, blocks };
}

const visual = (title: string): MessageBlock => ({
  kind: "visual",
  title,
  text: "A short summary.",
  code: "export default () => null",
});

const image = (artifactId: string): MessageBlock => ({
  kind: "image",
  artifactId,
  mimeType: "image/png",
  name: "quarter.png",
});

const file = (artifactId: string): MessageBlock => ({
  kind: "file",
  artifactId,
  mimeType: "text/plain",
  name: "notes.txt",
  size: 12,
});

describe("plainEmbedReferences", () => {
  it("names a visual or image by its label", () => {
    expect(plainEmbedReferences("See ![Flow](visual:m1) now.")).toBe("See [visual: Flow] now.");
    expect(plainEmbedReferences("![Quarter](image:art1)")).toBe("[image: Quarter]");
  });

  it("leaves a reference inside a fence or code span as written", () => {
    const fenced = "```\n![Flow](visual:m1)\n```";
    expect(plainEmbedReferences(fenced)).toBe(fenced);
    expect(plainEmbedReferences("Use `![Flow](visual:m1)` here")).toBe(
      "Use `![Flow](visual:m1)` here",
    );
  });

  it("unescapes the label and ignores a reference that is not one", () => {
    expect(plainEmbedReferences("![A \\[b\\]](visual:m1)")).toBe("[visual: A [b]]");
    expect(plainEmbedReferences("![plot](https://example.com/a.png)")).toBe(
      "![plot](https://example.com/a.png)",
    );
    expect(embedLine("visual", "A [b]", "m1")).toBe("![A \\[b\\]](visual:m1)");
  });

  it("reaches previews, quotes and copy as the named reference", () => {
    const source = "Before\n\n![Flow](visual:m1)\n\nAfter";
    expect(plainTextFromMarkdown(source)).toBe("Before [visual: Flow] After");
    expect(visibleTextFromMarkdown(source)).toContain("[visual: Flow]");
    expect(
      copyableMessageText({ blocks: [{ kind: "text", text: "![Quarter](image:art1)" }] }),
    ).toBe("[image: Quarter]");
  });
});

describe("placedEmbedMessages", () => {
  it("places a standalone when a later message of the same run references it", () => {
    const messages = [
      row("vis", [visual("Flow")], { runId: "run-1" }),
      row("img", [image("art1")], { runId: "run-1" }),
      row(
        "reply",
        [
          {
            kind: "text",
            text: `Intro\n\n${embedLine("visual", "Flow", "vis")}\n\n${embedLine("image", "Quarter", "art1")}`,
          },
        ],
        {
          runId: "run-1",
        },
      ),
    ];
    expect(placedEmbedMessages(messages).map((message) => message.id)).toEqual(["vis", "img"]);
  });

  it("places a standalone once the live progress row of that run references it", () => {
    const messages = [
      row("vis", [visual("Flow")], { runId: "run-1" }),
      row("progress:run-1", [{ kind: "progress", text: embedLine("visual", "Flow", "vis") }], {
        runId: "run-1",
      }),
    ];
    expect(placedEmbedMessages(messages).map((message) => message.id)).toEqual(["vis"]);
  });

  it("leaves an unreferenced embed where it is", () => {
    const messages = [
      row("vis", [visual("Flow")], { runId: "run-1" }),
      row("reply", [{ kind: "text", text: "No picture here." }], { runId: "run-1" }),
    ];
    expect(placedEmbedMessages(messages)).toEqual([]);
  });

  it("does not place a message another run references", () => {
    const messages = [
      row("vis", [visual("Flow")], { runId: "run-1" }),
      row("reply", [{ kind: "text", text: embedLine("visual", "Flow", "vis") }], {
        runId: "run-2",
      }),
    ];
    expect(placedEmbedMessages(messages)).toEqual([]);
    expect(embedReferencesIn(embedLine("visual", "Flow", "vis"))).toEqual([
      { kind: "visual", id: "vis", label: "Flow" },
    ]);
  });

  it("places a file card by its artifact and ignores a sample inside code", () => {
    const messages = [
      row("doc", [file("file1")], { runId: "run-1" }),
      row(
        "reply",
        [{ kind: "text", text: "```\n![Notes](image:file1)\n```\n\n![Notes](image:file1)" }],
        { runId: "run-1" },
      ),
    ];
    expect(placedEmbedMessages(messages).map((message) => message.id)).toEqual(["doc"]);
  });

  it("keeps a message with several images until the reply places all of them", () => {
    const messages = [
      row("pair", [image("art1"), image("art2")], { runId: "run-1" }),
      row("reply", [{ kind: "text", text: embedLine("image", "First", "art1") }], {
        runId: "run-1",
      }),
    ];
    expect(placedEmbedMessages(messages)).toEqual([]);
    messages.push(
      row("more", [{ kind: "text", text: embedLine("image", "Second", "art2") }], {
        runId: "run-1",
      }),
    );
    expect(placedEmbedMessages(messages).map((message) => message.id)).toEqual(["pair"]);
  });

  it("does not place a message that also has prose, or one with no run", () => {
    const messages = [
      row("mixed", [visual("Flow"), { kind: "text", text: "beside it" }], { runId: "run-1" }),
      row("loose", [image("art1")]),
      row("user", [image("art2")], { role: "user", runId: "run-1" }),
      row(
        "reply",
        [
          {
            kind: "text",
            text: `${embedLine("visual", "Flow", "mixed")}\n${embedLine("image", "Quarter", "art1")}\n${embedLine("image", "Shot", "art2")}`,
          },
        ],
        { runId: "run-1" },
      ),
    ];
    expect(placedEmbedMessages(messages)).toEqual([]);
  });
});

describe("embedTarget", () => {
  it("finds a held visual, image or file and prefers an image over a file", () => {
    const messages = [row("vis", [visual("Flow")]), row("both", [file("art1"), image("art1")])];
    expect(embedTarget(messages, { kind: "visual", id: "vis" })?.kind).toBe("visual");
    expect(embedTarget(messages, { kind: "image", id: "art1" })?.kind).toBe("image");
    expect(embedTarget(messages, { kind: "image", id: "missing" })).toBeNull();
    expect(embedTarget(messages, { kind: "visual", id: "nope" })).toBeNull();
  });
});
