To install dependencies:

```sh
bun install
```

To run:

```sh
bun run dev
```

open http://localhost:3000

## Production deployment

The backend image validates runtime configuration and then runs Prisma
migrations before starting the server. Configure
`DATABASE_URL` for an existing PostgreSQL database and `REDIS_URL` for an
existing Redis-compatible service. The database user needs permission to apply
migrations. Back up an existing database before applying schema changes and
ensure migrations remain compatible with the previous release during rollout.
Before accepting requests, the backend also checks PostgreSQL and Redis connectivity, lists S3 object versions, and checks that the configured R2 PMTiles object exists. These read-only checks require the corresponding credentials and permissions. If a check or migration fails, the new container does not start. Rolling back an image does
not reverse migrations.

Set the required environment variables in the root `.env.example`, including
the R2 variables, in Coolify. Set `BETTER_AUTH_URL` to
`https://api.openbeacon.net`. Optional variables may be added when needed; leave
them absent to use their defaults. The Coolify deployment declares
`TRUSTED_PROXY_PROVIDER` without a value to prevent startup until it is set.
For the hosted API, set `TRUSTED_PROXY_PROVIDER` to `cloudflare-authenticated`
and configure a random `CLOUDFLARE_ORIGIN_SECRET` of at least 32 characters in
Coolify. Configure Cloudflare to overwrite `X-OpenBeacon-Origin-Secret` with the
same secret only on HTTPS requests to `api.openbeacon.net`, and use Full (strict)
TLS for that hostname. Never add the secret to requests received over HTTP:
Full (strict) does not force Cloudflare to use HTTPS for those origin requests.
The backend requires that secret and a valid `CF-Connecting-IP` on every request
except `GET /health`, which Coolify uses for container health checks. Keep the
secret out of Git and logs. Verify that direct-origin API requests are rejected,
that Cloudflare overwrites a client-supplied secret header, and that different
clients get separate rate limits. Do not deploy with `none` behind the reverse
proxy: users would share the proxy's IP rate limit.

The `Deploy backend` GitHub Actions workflow also builds and deploys the separate scheduled job runner. See [the runner guide](../scheduled-jobs/README.md) for rollout and job requirements.

The `Deploy backend` GitHub Actions workflow is manually dispatched on `main`.
Configure
repository secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `COOLIFY_ENDPOINT`,
and `COOLIFY_TOKEN`. The deployment finds the Coolify application by its unique
name, `OpenBeacon Backend`. The Docker Hub account must be able
to push `lspsoftware/openbeacon-backend`. Each build publishes the commit SHA,
the backend version with a branch suffix, and a moving `branch-` tag. Branch
names are converted to lowercase Docker tags; non-main branches also receive a
hash suffix to distinguish similar names. A main build additionally publishes
the version without a suffix and updates `latest-stable`. Version tags are
updated if the same version is built again. Selecting the deploy option on main
also asks Coolify to deploy `latest-stable`. For the first deployment, apply the
Coolify infrastructure plan, populate its environment variables, and dispatch the
workflow with the deploy option. To roll back, point
Coolify at the desired commit SHA and redeploy;
restore `latest-stable` before the next normal deployment.
The workflow waits for Coolify to report the deployment result. If polling fails
or times out, check the deployment in Coolify before retrying. Avoid starting
other deployments manually while a workflow release is in progress.
