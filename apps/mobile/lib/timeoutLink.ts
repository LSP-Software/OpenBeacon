import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";

export class RequestTimeoutError extends Error {
  constructor() {
    super(SERVER_UNREACHABLE_MESSAGE);
    this.name = "RequestTimeoutError";
  }
}

export const timeoutLink =
  <TRouter extends AnyRouter>(): TRPCLink<TRouter> =>
  () =>
  ({ op, next }) =>
    observable((observer) => {
      const requestedTimeoutMs = op.context["timeoutMs"];
      const timeoutMs =
        typeof requestedTimeoutMs === "number"
          ? requestedTimeoutMs
          : op.type === "mutation"
            ? 30_000
            : 20_000;
      const controller = new AbortController();
      const onCallerAbort = () => {
        observer.error(TRPCClientError.from(new Error("Request cancelled")));
      };
      const timer = setTimeout(() => {
        observer.error(TRPCClientError.from(new RequestTimeoutError()));
      }, timeoutMs);
      op.signal?.addEventListener("abort", onCallerAbort, { once: true });
      const subscription = next({ ...op, signal: controller.signal }).subscribe(observer);
      if (op.signal?.aborted) onCallerAbort();

      return () => {
        clearTimeout(timer);
        op.signal?.removeEventListener("abort", onCallerAbort);
        subscription.unsubscribe();
        controller.abort();
      };
    });
