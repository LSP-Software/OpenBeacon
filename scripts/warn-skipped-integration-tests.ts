import { findIntegrationTestFiles, repoRoot } from "./integration-tests.ts";

if (process.env["OPENBEACON_INTEGRATION"] !== "1") {
  const files = await findIntegrationTestFiles(repoRoot);
  const tests = (
    await Promise.all(files.map((file) => Bun.file(`${repoRoot}${file}`).text()))
  ).reduce(
    (count, source) => count + (source.match(/^\s*(test|it)(\.[a-zA-Z]+)?\(/gm)?.length ?? 0),
    0,
  );

  console.warn(`
\x1b[33m⚠ Skipped ${tests} integration tests in ${files.length} files (OPENBEACON_INTEGRATION is not "1").
  They need PostgreSQL at DATABASE_URL and Redis at REDIS_URL. Apply the migrations, then run them with:

  bun run test:integration\x1b[0m
`);
}
