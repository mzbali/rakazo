import type { MarkdownEmbed } from "@rakazo/chat-ui/web";
import { MarkdownEmbedContext } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import { embedTarget } from "@rakazo/core";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import { VisualCard } from "../../components/visuals/VisualCard";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { ArtifactImage } from "./message-cards";

/** Resolves embed images from messages this transcript already holds. */
export function TranscriptEmbeds({
  messages,
  target,
  children,
}: {
  messages: readonly { id: string; blocks: readonly MessageBlock[] }[];
  target: ArtifactTarget;
  children: ReactNode;
}) {
  const resolve = useCallback(
    (embed: MarkdownEmbed) => {
      const found = embedTarget(messages, embed);
      if (!found) return null;
      if (found.kind === "visual") return <VisualCard block={found.block} />;
      if (found.kind === "image") {
        return (
          <ArtifactImage
            target={target}
            artifactId={found.block.artifactId}
            name={found.block.name}
          />
        );
      }
      return (
        <ArtifactFileCard
          target={target}
          artifactId={found.block.artifactId}
          name={found.block.name}
          mimeType={found.block.mimeType}
          size={found.block.size}
        />
      );
    },
    [messages, target],
  );
  return <MarkdownEmbedContext.Provider value={resolve}>{children}</MarkdownEmbedContext.Provider>;
}
