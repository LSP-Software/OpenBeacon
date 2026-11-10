if (process.env["OPENBEACON_INTEGRATION"] !== "1") {
  const root = new URL("..", import.meta.url).pathname;
  const files = (
    await Array.fromAsync(
      new Bun.Glob("{apps,packages}/*/**/*.integration.test.ts").scan({ cwd: root }),
    )
  )
    .filter((file) => !file.includes("node_modules/"))
    .sort();
  const tests = (await Promise.all(files.map((file) => Bun.file(`${root}${file}`).text()))).reduce(
    (count, source) => count + (source.match(/^\s*(test|it)(\.[a-zA-Z]+)?\(/gm)?.length ?? 0),
    0,
  );

  console.warn(`
\x1b[33m⚠ Skipped ${tests} integration tests in ${files.length} files (OPENBEACON_INTEGRATION is not "1").
  They need PostgreSQL at DATABASE_URL and Redis at REDIS_URL. Apply the migrations, then run them with:

  OPENBEACON_INTEGRATION=1 bun test --isolate --env-file=.env.ci $(find . -name '*.integration.test.ts' -not -path '*/node_modules/*')\x1b[0m
`);
}
