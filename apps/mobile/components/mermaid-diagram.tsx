import { useLingui } from "@lingui/react/macro";
import { chatMermaidConfig } from "@rakazo/chat-ui/mermaid";
import type { MermaidDiagramProps } from "@rakazo/chat-ui/native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { currentApiBase, subscribeApiBase } from "../lib/api";
import {
  DIAGRAM_TIMEOUT_MS,
  diagramBootScript,
  diagramDocument,
  diagramScriptUrl,
  parseDiagramMessage,
} from "../lib/mermaid-webview";

type DiagramState =
  | { status: "drawing" }
  | { status: "measured" | "drawn"; height: number }
  | { status: "failed" };

function isDiagramDocument(url: string): boolean {
  return url === "about:blank" || url === "about:blank/";
}

/**
 * Draws a chat diagram in a WebView. The code block stays on screen until the diagram reports
 * its height, and comes back for good if Mermaid cannot load or parse the source.
 */
export function MermaidDiagram({ source, palette, colorScheme, fallback }: MermaidDiagramProps) {
  const { t } = useLingui();
  const endpoint = useSyncExternalStore(subscribeApiBase, currentApiBase, currentApiBase);
  const html = useMemo(() => diagramDocument(diagramScriptUrl(endpoint)), [endpoint]);
  const boot = useMemo(
    () =>
      diagramBootScript(
        source,
        chatMermaidConfig(palette, colorScheme, { surface: palette.background }),
      ),
    [source, palette, colorScheme],
  );
  const page = `${html}\n${boot}`;
  const [state, setState] = useState<{ page: string; diagram: DiagramState }>({
    page,
    diagram: { status: "drawing" },
  });
  const diagram = state.page === page ? state.diagram : { status: "drawing" as const };

  useEffect(() => {
    const timer = setTimeout(() => {
      setState((current) =>
        current.page === page && current.diagram.status !== "drawing"
          ? current
          : { page, diagram: { status: "failed" } },
      );
    }, DIAGRAM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [page]);

  if (diagram.status === "failed") return fallback;
  const drawn = diagram.status !== "drawing";
  const ready = diagram.status === "drawn";
  const fail = () => setState({ page, diagram: { status: "failed" } });

  return (
    <View style={styles.wrap}>
      {ready ? null : fallback}
      <View
        // Replace the hidden native container too, so its opacity and layout cannot persist.
        key={`${page}:${drawn ? "shown" : "measure"}`}
        style={
          drawn
            ? [styles.card, { backgroundColor: palette.background, borderColor: palette.border }]
            : styles.measuring
        }
        pointerEvents={drawn ? "auto" : "none"}
        accessible={drawn}
        accessibilityRole="image"
        accessibilityLabel={t`Diagram`}
      >
        <WebView
          source={{ html, baseUrl: "about:blank" }}
          injectedJavaScript={boot}
          onMessage={(event) => {
            const message = parseDiagramMessage(event.nativeEvent.data);
            if (!message) return;
            setState((current) => {
              // Ignore queued reports from the measuring view after its replacement mounts.
              if (!drawn && current.page === page && current.diagram.status !== "drawing") {
                return current;
              }
              return {
                page,
                diagram:
                  message.type === "drawn"
                    ? { status: drawn ? "drawn" : "measured", height: message.height }
                    : { status: "failed" },
              };
            });
          }}
          onError={fail}
          onHttpError={fail}
          style={styles.webview}
          // The library's container flexes by default, which gives it no height inside a card
          // sized by its content, so the drawn diagram was clipped to an empty strip.
          containerStyle={[styles.webviewContainer, { height: drawn ? diagram.height : 1 }]}
          javaScriptEnabled
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          javaScriptCanOpenWindowsAutomatically={false}
          domStorageEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          // Sideways only: the page is exactly as tall as the WebView.
          scrollEnabled
          nestedScrollEnabled
          bounces={false}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          onShouldStartLoadWithRequest={({ url }) => isDiagramDocument(url)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  card: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    overflow: "hidden",
  },
  // Laid out at full width but unseen, so the page measures the height it will be shown at.
  measuring: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  webviewContainer: { flex: 0, width: "100%" },
  webview: { backgroundColor: "transparent" },
});
