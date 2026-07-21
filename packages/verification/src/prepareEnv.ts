import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tryCatch } from "@openbeacon/shared";
import { resolveConfig } from "./config.ts";

const postJson = (url: string, body: unknown): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const main = async (): Promise<number> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const config = resolveConfig(repoRoot);
  const base = `http://localhost:${config.backendPort}`;

  const health = await tryCatch(fetch(`${base}/api/auth/ok`));
  if (health.error || !health.data.ok) {
    console.error(`Backend not reachable at ${base}. Start it with the verification env first.`);
    return 2;
  }

  const signUp = await tryCatch(
    postJson(`${base}/api/auth/sign-up/email`, {
      name: config.account.name,
      email: config.account.email,
      password: config.account.password,
    }),
  );
  if (signUp.error) {
    console.error(`Sign-up request failed: ${signUp.error.message}`);
    return 1;
  }
  if (signUp.data.status !== 200) {
    console.info(`Throwaway account already present (sign-up status ${signUp.data.status}).`);
  } else {
    console.info(`Created throwaway account ${config.account.email}.`);
  }

  const signIn = await tryCatch(
    postJson(`${base}/api/auth/sign-in/email`, {
      email: config.account.email,
      password: config.account.password,
    }),
  );
  if (signIn.error || signIn.data.status !== 200) {
    console.error("Throwaway account sign-in check failed.");
    return 1;
  }

  console.info("Throwaway environment ready: account can sign in.");
  return 0;
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
