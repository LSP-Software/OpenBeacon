import { describe, expect, test } from "bun:test";
import TestRenderer, { act } from "react-test-renderer";
import { useSingleFlight } from "./useSingleFlight.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const createDeferred = <T,>() => {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};

  return {
    promise: new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }),
    reject,
    resolve,
  };
};

const getButtons = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType("button");

const pressButton = (renderer: TestRenderer.ReactTestRenderer, buttonIndex: number) => {
  const button = getButtons(renderer)[buttonIndex];

  if (!button) {
    throw new Error(`Missing button at index ${buttonIndex}`);
  }

  const props = button.props as {
    onClick?: () => void;
  };

  props.onClick?.();
};

const renderHookHarness = async ({
  onFirstRun,
  onSecondRun,
}: {
  onFirstRun: () => Promise<void>;
  onSecondRun: () => Promise<void>;
}) => {
  const Harness = () => {
    const singleFlight = useSingleFlight<string>();
    const run = (key: string, operation: () => Promise<void>) => {
      void singleFlight.run(key, operation).catch(() => {});
    };

    return (
      <>
        <button onClick={() => run("first", onFirstRun)} type="button">
          First
        </button>
        <button onClick={() => run("second", onSecondRun)} type="button">
          Second
        </button>
      </>
    );
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  await act(async () => {
    renderer = TestRenderer.create(<Harness />);
    await Promise.resolve();
  });

  if (renderer === null) {
    throw new Error("Renderer was not created");
  }

  return renderer;
};

describe("useSingleFlight", () => {
  test("ignores duplicate and concurrent submissions until the first call completes", async () => {
    const calls: string[] = [];
    const firstRunDeferred = createDeferred<void>();
    const renderer = await renderHookHarness({
      onFirstRun: async () => {
        calls.push("first");
        await firstRunDeferred.promise;
      },
      onSecondRun: async () => {
        calls.push("second");
      },
    });

    await act(async () => {
      pressButton(renderer, 0);
      pressButton(renderer, 0);
      pressButton(renderer, 1);
      await Promise.resolve();
    });

    expect(calls).toEqual(["first"]);

    firstRunDeferred.resolve();

    await act(async () => {
      await firstRunDeferred.promise;
      await Promise.resolve();
    });

    await act(async () => {
      pressButton(renderer, 1);
      await Promise.resolve();
    });

    expect(calls).toEqual(["first", "second"]);
  });

  test("clears the single-flight gate after a rejected run", async () => {
    const calls: string[] = [];
    const firstRunDeferred = createDeferred<void>();
    const rejectedRun = firstRunDeferred.promise.catch(() => undefined);
    const renderer = await renderHookHarness({
      onFirstRun: async () => {
        calls.push("first");
        await firstRunDeferred.promise;
      },
      onSecondRun: async () => {
        calls.push("second");
      },
    });

    await act(async () => {
      pressButton(renderer, 0);
      await Promise.resolve();
    });

    expect(calls).toEqual(["first"]);

    await act(async () => {
      firstRunDeferred.reject(new Error("failed"));
      await rejectedRun;
      await Promise.resolve();
    });

    await act(async () => {
      pressButton(renderer, 1);
      await Promise.resolve();
    });

    expect(calls).toEqual(["first", "second"]);
  });
});
