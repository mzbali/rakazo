import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { typeScale } from "@rakazo/ui-tokens";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { imageArtifactUri } from "../lib/artifact-open";
import { hapticSelection } from "../lib/haptics";
import { JobStatusDot, jobToneColor } from "./job-status";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;
type ProofImage = NonNullable<Job["proofImages"]>[number];

function Thumbnail({
  image,
  target,
  onOpen,
}: {
  image: ProofImage;
  target: MobileArtifactTarget;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const botId = "botId" in target ? target.botId : undefined;
  const groupId = "groupId" in target ? target.groupId : undefined;
  useEffect(() => {
    let cancelled = false;
    void imageArtifactUri(
      botId ? { botId } : { groupId: groupId! },
      image.artifactId,
      image.mimeType,
    )
      .then((loaded) => {
        if (!cancelled) setUri(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [image.artifactId, image.mimeType, botId, groupId]);
  if (failed) return null;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={t`Open screenshot`}
      onPress={() => {
        hapticSelection();
        onOpen();
      }}
      style={{
        flex: 1,
        aspectRatio: 0.62,
        borderRadius: 8,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.muted,
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ flex: 1 }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
        />
      ) : null}
    </Pressable>
  );
}

/** The screenshots a finished job's pull request showed, up to three, each opening full size. */
export function JobProofImages({
  job,
  target,
}: {
  job: Pick<Job, "proofImages">;
  target: MobileArtifactTarget;
}) {
  const router = useRouter();
  const images = job.proofImages?.slice(0, 3);
  if (!images?.length) return null;
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
      {images.map((image) => (
        <Thumbnail
          key={image.artifactId}
          image={image}
          target={target}
          onOpen={() =>
            router.push({
              pathname: "/image",
              params: {
                artifactId: image.artifactId,
                name: image.name,
                mimeType: image.mimeType,
                ...target,
              },
            })
          }
        />
      ))}
      {Array.from({ length: 3 - images.length }, (_, i) => (
        <View key={`gap-${i}`} style={{ flex: 1 }} />
      ))}
    </View>
  );
}
