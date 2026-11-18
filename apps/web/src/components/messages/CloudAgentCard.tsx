import { Plural, Trans } from "@lingui/react/macro";
import { useNow as useTickingNow } from "@rakazo/chat-ui/hooks";
import { AppLinkPill, allowedAppLink } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import type { CloudAgentPhase, CloudAgentPullRequestPart, CloudAgentWorkPart } from "@rakazo/core";
import {
  cloudAgentElapsed,
  cloudAgentHttpsUrl,
  cloudAgentJobTone,
  cloudAgentPhase,
  cloudAgentPullRequestNumber,
  cloudAgentPullRequestParts,
  cloudAgentTicking,
  cloudAgentWorkParts,
  formatCloudAgentResumeAt,
} from "@rakazo/core";
import { Badge } from "@rakazo/ui-web/components/ui/badge";
import { buttonVariants } from "@rakazo/ui-web/components/ui/button";
import { Card, CardContent } from "@rakazo/ui-web/components/ui/card";

/** The clock for a running job: each second in its first minute, then every 15. */
function useNow(live: boolean, startedAt: string | undefined) {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  return useTickingNow(live ? (Date.now() - started < 60_000 ? 1000 : 15_000) : null);
}

function PhaseLabel({ phase }: { phase: CloudAgentPhase }) {
  switch (phase) {
    case "starting":
      return <Trans>Starting</Trans>;
    case "working":
      return <Trans>Working</Trans>;
    case "checking":
      return <Trans>Checking</Trans>;
    case "done":
      return <Trans>Done</Trans>;
    case "needsYou":
      return <Trans>Needs you</Trans>;
    case "resumes":
      return <Trans>Resumes</Trans>;
    case "couldntStart":
      return <Trans>Couldn't start</Trans>;
    case "stopped":
      return <Trans>Stopped</Trans>;
    default:
      return <Trans>Expired</Trans>;
  }
}

function PullRequestPart({ part }: { part: CloudAgentPullRequestPart }) {
  switch (part) {
    case "merged":
      return <Trans>merged</Trans>;
    case "closed":
      return <Trans>closed</Trans>;
    case "checksRunning":
      return <Trans>checks running</Trans>;
    case "checksPassing":
      return <Trans>checks passing</Trans>;
    default:
      return <Trans>checks failing</Trans>;
  }
}

function WorkPart({ part }: { part: CloudAgentWorkPart }) {
  switch (part.kind) {
    case "subagent":
      return <Plural value={part.count} one="# subagent" other="# subagents" />;
    case "command":
      return <Plural value={part.count} one="# command" other="# commands" />;
    case "monitor":
      return <Plural value={part.count} one="# monitor" other="# monitors" />;
    case "background_task":
      return <Plural value={part.count} one="# background task" other="# background tasks" />;
    default:
      return <Plural value={part.count} one="watching PR" other="watching # PRs" />;
  }
}

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
  const phase = cloudAgentPhase(block);
  const tone = cloudAgentJobTone(block);
  const now = useNow(cloudAgentTicking(block), block.startedAt);
  const resumeAt =
    phase === "resumes" && block.quotaResetsAt
      ? formatCloudAgentResumeAt(block.quotaResetsAt, now)
      : undefined;
  const elapsed = resumeAt ? undefined : cloudAgentElapsed(block, now);
  const prHref = cloudAgentHttpsUrl(block.prUrl);
  const prNumber = cloudAgentPullRequestNumber(block.prUrl);
  const ownerQuestion = block.ownerQuestion;
  const href = block.launchFailed
    ? undefined
    : (cloudAgentHttpsUrl(block.url) ?? allowedAppLink(block.url));
  const live = phase === "starting" || phase === "working" || phase === "checking";
  return (
    <Card size="sm" className="w-full" data-testid="cloud-agent-card">
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
            <PhaseLabel phase={phase} />
            {resumeAt || elapsed ? (
              <span className="tabular-nums">{resumeAt ?? elapsed}</span>
            ) : null}
          </Badge>
        </div>
        {block.unreachableSince && live ? (
          <span className="text-muted-foreground">
            <Trans>Resumes when it's back · since {since}</Trans>
          </span>
        ) : null}
        {live && block.progress ? (
          <span className="line-clamp-2 text-muted-foreground" dir="auto">
            {block.progress}
          </span>
        ) : null}
        {block.status === "failed" && block.failureReason ? (
          <span className="text-destructive" dir="auto">
            {block.failureReason}
          </span>
        ) : null}
        {phase === "needsYou" && ownerQuestion ? (
          <span className="font-medium text-warning" dir="auto">
            {ownerQuestion}
          </span>
        ) : null}
        {live && cloudAgentWorkParts(block).length ? (
          <div className="flex flex-wrap gap-x-3 text-muted-foreground">
            {cloudAgentWorkParts(block).map((part) => (
              <span key={part.kind}>
                <WorkPart part={part} />
              </span>
            ))}
          </div>
        ) : null}
        {prHref || href ? (
          <div className="flex flex-wrap items-center gap-2">
            {prNumber !== undefined ? (
              <Badge variant="outline" className="gap-1.5">
                <Trans>PR #{prNumber}</Trans>
                {cloudAgentPullRequestParts(block).map((part) => (
                  <span key={part} className="text-muted-foreground">
                    <PullRequestPart part={part} />
                  </span>
                ))}
              </Badge>
            ) : null}
            {href && allowedAppLink(href) ? (
              <AppLinkPill href={href} />
            ) : href ? (
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>Open in T3</Trans>
              </a>
            ) : null}
            {prHref ? (
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={prHref}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>View PR</Trans>
              </a>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
