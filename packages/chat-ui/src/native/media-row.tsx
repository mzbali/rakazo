import type { ASTNode } from "@ronradtke/react-native-markdown-display";
import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import type { MediaPiece } from "../media-row";
import { openingMediaImage } from "../media-row";

const WRAPPERS = new Set(["textgroup", "paragraph"]);

/** The fixed thumbnail a media row puts on the left. The list item finds it by this type. */
export function MediaThumb({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

export function isMediaThumb(child: ReactNode): child is ReactElement {
  return isValidElement(child) && child.type === MediaThumb;
}

function visitInlines(node: ASTNode, visit: (child: ASTNode) => void) {
  for (const child of node.children) {
    if (WRAPPERS.has(child.type)) visitInlines(child, visit);
    else visit(child);
  }
}

/** Inlines of a block, descending only through the wrappers that hold them. */
export function astMediaPieces(node: ASTNode): MediaPiece[] {
  const pieces: MediaPiece[] = [];
  visitInlines(node, (child) => {
    if (child.type === "text" || child.type === "softbreak" || child.type === "hardbreak") {
      pieces.push({ type: "text", value: child.type === "text" ? child.content : "\n" });
      return;
    }
    if (child.type === "image") {
      pieces.push({
        type: "image",
        src: child.attributes.src ?? "",
        alt: child.attributes.alt ?? "",
      });
      return;
    }
    pieces.push({ type: "other" });
  });
  return pieces;
}

/** The image node a media row opens with, when this block is one. */
export function openingImageNode(node: ASTNode): ASTNode | undefined {
  if (!openingMediaImage(astMediaPieces(node))) return undefined;
  let found: ASTNode | undefined;
  visitInlines(node, (child) => {
    if (found) return;
    if (child.type === "text" || child.type === "softbreak" || child.type === "hardbreak") return;
    if (child.type === "image") found = child;
  });
  return found;
}

export function isMediaRowNode(node: ASTNode): boolean {
  return openingMediaImage(astMediaPieces(node)) !== undefined;
}
