import { randomUUID } from "node:crypto";
import type {
  CloudAgentAttention,
  CloudAgentProvider,
  CloudAgentSnapshot,
} from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";

/** A scripted provider: each remote agent's state is set by the test. */
export class ScriptedProvider implements CloudAgentProvider {
  readonly agents = new Map<
    string,
    {
      status: CloudAgentSnapshot["status"];
      attention: CloudAgentAttention[];
      missed?: CloudAgentAttention[];
      cursor: number;
      latestRunId?: string;
      /** A pull request watch with no run working. */
      watching?: boolean;
      watchIdle?: boolean;
      quotaResetsAt?: string;
      quotaAutoResume?: boolean;
      /** The owner settled or archived it in the provider, with nothing left open there. */
      closed?: boolean;
    }
  >();
  launches = 0;
  /** Holds a read after it is taken, as a slow poll would, until the test lets it return. */
  stall?: Promise<void>;
  describe() {
    return {
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { launch: true, reply: true, cancel: true, offline: true },
    };
  }
  async launch(request: { idempotencyKey: string }) {
    this.launches += 1;
    const id = `remote:${request.idempotencyKey}`;
    if (!this.agents.has(id)) this.agents.set(id, { status: "running", attention: [], cursor: 0 });
    return { id, url: "", title: "", status: "running" as const };
  }
  async get(id: string) {
    this.agents.get(id)!.cursor += 1;
    const { missed = [], ...agent } = this.agents.get(id)!;
    // Closed blockers are events: each is reported once, from the cursor that saw it.
    delete this.agents.get(id)!.missed;
    const read = { ...agent, attention: [...agent.attention] };
    await this.stall;
    return {
      id,
      url: "",
      title: "",
      ...read,
      missedAttention: missed,
    };
  }
  replies = 0;
  replyPrompts: string[] = [];
  replyKeys: (string | undefined)[] = [];
  /** Makes the next reply wait for the test, then refuse as a busy provider would. */
  refuseReply?: Promise<void>;
  async reply(id: string, request: { prompt: string; idempotencyKey?: string }) {
    this.replies += 1;
    this.replyPrompts.push(request.prompt);
    this.replyKeys.push(request.idempotencyKey);
    if (this.refuseReply) {
      const refusal = this.refuseReply;
      this.refuseReply = undefined;
      await refusal;
      throw new CloudAgentRetryLater("unavailable");
    }
    return { id, url: "", title: "", status: "running" as const, latestRunId: randomUUID() };
  }
  async cancel(id: string) {
    return this.get(id);
  }
  async ownerClosed(id: string) {
    return this.agents.get(id)!.closed === true;
  }
  settled: string[] = [];
  /** Makes settling fail the way a connection without the permission does. */
  refuseSettle = false;
  async settle(id: string) {
    this.settled.push(id);
    if (this.refuseSettle) throw new CloudAgentRequestRejected("invalid");
  }
}
