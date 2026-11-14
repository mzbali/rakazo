import { Trans } from "@lingui/react/macro";
import { allowedAppLink } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentHttpsUrl, cloudAgentState, cloudAgentTone } from "@rakazo/core";
import { Badge } from "@rakazo/ui-web/components/ui/badge";
import { Card, CardContent } from "@rakazo/ui-web/components/ui/card";

export function CloudAgentCard({
  block,
}: {
  block: Extract<MessageBlock, { kind: "cloud_agent" }>;
}) {
  const since = block.unreachableSince
    ? new Date(block.unreachableSince).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const state = cloudAgentState(block);
  const tone = cloudAgentTone(state);
  const prHref = cloudAgentHttpsUrl(block.prUrl);
  const href = prHref ?? cloudAgentHttpsUrl(block.url) ?? allowedAppLink(block.url);
  const content = (
    <Card size="sm" className="w-80 max-w-full" data-testid="cloud-agent-card">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium" dir="auto">
            {block.title}
          </span>
          <Badge
            variant="secondary"
            className={
              tone === "danger"
                ? "text-destructive"
                : tone === "success"
                  ? "text-success"
                  : tone === "attention"
                    ? "text-warning"
                    : "text-muted-foreground"
            }
          >
            {state === "unreachable" ? (
              <Trans>unreachable</Trans>
            ) : state === "needsInput" ? (
              <Trans>needs input</Trans>
            ) : state === "queued" ? (
              <Trans>queued</Trans>
            ) : state === "running" ? (
              <Trans>running</Trans>
            ) : state === "finished" ? (
              <Trans>finished</Trans>
            ) : state === "cancelled" ? (
              <Trans>cancelled</Trans>
            ) : state === "expired" ? (
              <Trans>expired</Trans>
            ) : (
              <Trans>failed</Trans>
            )}
          </Badge>
        </div>
        {state === "unreachable" ? (
          <span className="text-muted-foreground">
            <Trans>Resumes when it's back · since {since}</Trans>
          </span>
        ) : null}
        {block.ownerQuestion ? (
          <span className="font-medium text-warning" dir="auto">
            <Trans>Needs you: {block.ownerQuestion}</Trans>
          </span>
        ) : null}
        {prHref ? (
          <span className="text-muted-foreground">
            <Trans>Pull request</Trans>
          </span>
        ) : block.branch ? (
          <span className="text-muted-foreground" dir="auto">
            {block.branch}
          </span>
        ) : null}
        {block.note ? (
          <span className="text-muted-foreground" dir="auto">
            {block.note}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="block max-w-full no-underline">
      {content}
    </a>
  ) : (
    content
  );
}
