/**
 * The one Durable Object of the pager, which runs every request and every run of
 * the schedule. The state lives in Workers KV, which has no compare-and-swap and
 * shows a write in other places of Cloudflare's network only after a while: two
 * failing checks at the same moment, or a button pressed twice, would each read
 * the old state and overwrite the other. Here, in one place, the changes run one
 * after another, and each reads what the one before wrote. Its own storage keeps
 * the pager's notes on itself, such as the time of the schedule's last run.
 */
import { DurableObject } from "cloudflare:workers";

import { makeContext } from "./context.ts";
import { type Route, schedule, serve } from "./routes.ts";
import type { PagerEnv, Settings } from "./settings.ts";

export class Serial extends DurableObject<PagerEnv> {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run one change after the one before, whether that one failed or not. A call to
   * an API lets another request into the object while it waits, so the order comes
   * from this queue, not from the runtime.
   */
  private readonly exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = this.tail.then(work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  private context(settings: Settings) {
    return makeContext(
      settings,
      this.env,
      undefined,
      undefined,
      undefined,
      this.exclusive,
      this.ctx.storage,
    );
  }

  /** A request of Telegram, GitHub or the control repository. */
  handle(
    settings: Settings,
    route: Route,
    request: Request,
  ): Promise<Response> {
    return serve(this.context(settings), route, request);
  }

  /** A run of the schedule. */
  schedule(settings: Settings): Promise<void> {
    return schedule(this.context(settings));
  }
}
