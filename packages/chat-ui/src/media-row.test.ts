import { describe, expect, it } from "vitest";
import type { MediaPiece } from "./media-row";
import { openingMediaImage } from "./media-row";

const image = (src: string, alt = "Photo"): MediaPiece => ({ type: "image", src, alt });

describe("openingMediaImage", () => {
  it("opens a row on an image embed that has something after it", () => {
    expect(
      openingMediaImage([
        { type: "text", value: " \n" },
        image("image:ferry", "Harbor ferry"),
        { type: "text", value: " " },
        { type: "other" },
      ]),
    ).toEqual({ src: "image:ferry", alt: "Harbor ferry" });
  });

  it("leaves an image alone, a visual, a remote picture, and a later image as they are", () => {
    expect(openingMediaImage([image("image:ferry")])).toBeUndefined();
    expect(
      openingMediaImage([image("image:ferry"), { type: "text", value: "   " }]),
    ).toBeUndefined();
    expect(
      openingMediaImage([image("visual:message_1", "Flow"), { type: "text", value: " still" }]),
    ).toBeUndefined();
    expect(
      openingMediaImage([
        image("https://images.example.test/a.png"),
        { type: "text", value: " caption" },
      ]),
    ).toBeUndefined();
    expect(
      openingMediaImage([
        { type: "text", value: "See " },
        image("image:ferry"),
        { type: "text", value: " today" },
      ]),
    ).toBeUndefined();
  });
});
