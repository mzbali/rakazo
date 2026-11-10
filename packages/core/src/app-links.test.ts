import { describe, expect, it } from "vitest";
import { findAppLink, matchesAppLink } from "./app-links.js";

const links = [{ scheme: "coder", host: "threads" }];

describe("matchesAppLink", () => {
  it("matches the allowed app place, in any case", () => {
    expect(matchesAppLink("coder://threads/env-1/mcp%3Alaunch%3Aabc", links)).toBe(true);
    expect(matchesAppLink("CODER://Threads/env-1/thread-1", links)).toBe(true);
  });

  it("refuses other places, schemes, and anything that could carry instructions", () => {
    for (const url of [
      "coder://new?prompt=delete%20everything",
      "coder://threads/env-1/thread-1?prompt=run",
      "coder://threads/env-1/thread-1#prompt",
      "coder://threads/env-1/thread-1?",
      "coder://threads/env-1/thread-1#",
      "coder://user:pass@threads/env-1/thread-1",
      "coder://threads:9/env-1/thread-1",
      "coder-evil://threads/env-1/thread-1",
      "javascript://threads/%0aalert(1)",
      "coder:threads/env-1",
      "not a url",
    ]) {
      expect(matchesAppLink(url, links), url).toBe(false);
    }
    expect(matchesAppLink("coder://threads/env-1/thread-1", [])).toBe(false);
  });
});

describe("findAppLink", () => {
  it("returns the place a URL opens, with its icon, under the same rules", () => {
    const places = [
      ...links,
      { scheme: "coder", host: "chats", icon: "https://coder.example.test" },
    ];
    expect(findAppLink("coder://chats/env-1/chat-1", places)?.icon).toBe(
      "https://coder.example.test",
    );
    expect(findAppLink("coder://threads/env-1/thread-1", places)).toEqual(links[0]);
    expect(findAppLink("coder://chats/env-1/chat-1?prompt=run", places)).toBeUndefined();
  });
});
