import { useLingui } from "@lingui/react/macro";
import type { MarkdownEmbed } from "@rakazo/chat-ui/native";
import { MarkdownEmbedContext } from "@rakazo/chat-ui/native";
import { artifactPreviewKind, isAttachmentAudioMimeType } from "@rakazo/contracts";
import { embedTarget, formatFileSize } from "@rakazo/core";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { Alert, Pressable, Text } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import { openMobileArtifact } from "../../lib/artifact-open";
import type { MobileMessage } from "../../lib/mobile-types";
import { errorText } from "../../lib/user-error";
import { AudioAttachment } from "../audio-attachment";
import { InlineImageAttachment } from "../inline-image-attachment";
import { VisualCard } from "./visual-card";

/** Resolves embed images from messages this thread already holds. */
export function ThreadEmbeds({
  messages,
  threadTarget,
  onPreviewImage,
  onPreviewFile,
  children,
}: {
  messages: readonly MobileMessage[];
  threadTarget: MobileArtifactTarget | undefined;
  onPreviewImage: (target: { artifactId: string; name: string; mimeType: string }) => void;
  onPreviewFile: (artifactId: string) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const resolve = useCallback(
    (embed: MarkdownEmbed) => {
      if (!threadTarget) return null;
      const found = embedTarget(messages, embed);
      if (!found) return null;
      if (found.kind === "visual") return <VisualCard block={found.block} />;
      if (found.kind === "image") {
        const block = found.block;
        return (
          <InlineImageAttachment
            threadTarget={threadTarget}
            artifactId={block.artifactId}
            name={block.name}
            mimeType={block.mimeType}
            thumbnail={embed.frame === "thumbnail"}
            source={embed.frame === "thumbnail" ? undefined : block.source}
            labelColor={tokens.foreground}
            onOpen={() =>
              onPreviewImage({
                artifactId: block.artifactId,
                name: block.name,
                mimeType: block.mimeType,
              })
            }
          />
        );
      }
      const block = found.block;
      if (isAttachmentAudioMimeType(block.mimeType)) {
        return (
          <AudioAttachment
            target={threadTarget}
            artifactId={block.artifactId}
            name={block.name}
            mimeType={block.mimeType}
          />
        );
      }
      const size = formatFileSize(block.size);
      return (
        <Pressable
          onPress={() => {
            if (artifactPreviewKind(block.mimeType) !== "none") onPreviewFile(block.artifactId);
            else {
              void openMobileArtifact(
                threadTarget,
                block.artifactId,
                block.name,
                block.mimeType,
              ).catch((err) => Alert.alert(t`Could not open file`, errorText(err, t`Try again.`)));
            }
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 15 }}>{block.name}</Text>
          {size ? (
            <Text style={{ color: tokens.mutedForeground, marginTop: 4, fontSize: 13 }}>
              {size}
            </Text>
          ) : null}
        </Pressable>
      );
    },
    [
      messages,
      onPreviewFile,
      onPreviewImage,
      t,
      threadTarget,
      tokens.foreground,
      tokens.mutedForeground,
    ],
  );
  return <MarkdownEmbedContext.Provider value={resolve}>{children}</MarkdownEmbedContext.Provider>;
}
