To install dependencies:

```sh
bun install
```

To run:

```sh
bun run dev
```

open http://localhost:3000

Set `SERVER_NAME` in the root `.env` to the public name shown in the health check and app. It defaults to `OpenBeacon`. `GET /health` returns the status, backend version, and server name.

## Production deployment

The backend image validates runtime configuration and then runs Prisma
migrations before starting the server. Configure
`DATABASE_URL` for an existing PostgreSQL database, `REDIS_URL` for an
existing Redis-compatible service and `REDIS_HASH_SECRET` (at least 32
characters, for example from `openssl rand -base64 32`). The database user needs permission to apply
migrations. Back up an existing database before applying schema changes and
ensure migrations remain compatible with the previous release during rollout.
Before accepting requests, the backend also checks PostgreSQL and Redis connectivity, lists S3 object versions, reads the map tiles manifest from R2 and checks that the current PMTiles archive exists (with no manifest yet it starts anyway, the app shows that the map isn't ready, and the backend logs every 5 minutes until the map tiles service publishes the first map), and checks the email provider when one is configured. See `apps/map-tiles/README.md` for publishing new map data. These read-only checks require the corresponding credentials and permissions. If a check or migration fails, the new container does not start. Rolling back an image does
not reverse migrations.

For Google account deletion verification, add `<BETTER_AUTH_URL>/api/auth/google-deletion-callback` as an authorized redirect URI on the Google web OAuth client configured by `GOOGLE_CLIENT_ID`. For the hosted API this is `https://api.openbeacon.net/api/auth/google-deletion-callback`; each self-hosted backend needs its own exact public callback URI registered with its Google client. The Google account chooser may reuse an existing Google browser session and does not guarantee a fresh password prompt.

Set the required environment variables in the root `.env.example`, including
the R2 variables, in Coolify. Set `BETTER_AUTH_URL` to
`https://api.openbeacon.net` and `SELF_HOSTED` to `false`. `SELF_HOSTED` defaults
to `true`, so self-hosted backends never accept app feedback; the app always
sends feedback to the hosted API. Set `DISCORD_FEEDBACK_WEBHOOK_URL` on the hosted
API to get a Discord alert for each new feedback; the alert holds only the
feedback ID and whether a contact email was given. Optional variables may be added when needed; leave
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

Self-hosted backends behind a single reverse proxy such as Traefik, Caddy or
nginx can use `trusted-proxy`. The backend uses the last `X-Forwarded-For` entry,
so the proxy must append the connecting address to that header (nginx:
`$proxy_add_x_forwarded_for`) and the backend port must not be reachable except
through the proxy. `cloudflare` trusts `CF-Connecting-IP` without verifying the
request came from Cloudflare, so only use it when the origin is reachable solely
through Cloudflare, for example via Cloudflare Tunnel or a firewall that only
allows Cloudflare's IP ranges. Otherwise use `cloudflare-authenticated`.

### Serving the backend under a path

The backend can share a domain with other apps by sitting under a path, such as
`https://example.com/openbeacon`. Set `BETTER_AUTH_URL` to the full public URL,
path included (`https://example.com/openbeacon`), and enter the same URL in the
app. The reverse proxy must remove the path before it forwards the request, so
`https://example.com/openbeacon/api/trpc/…` reaches the backend as `/api/trpc/…`
and `https://example.com/openbeacon/health` as `/health`. For example, in nginx:

```nginx
location /openbeacon/ {
    proxy_pass http://openbeacon-backend:3000/;
}
```

Caddy's `handle_path /openbeacon/*` and Traefik's `StripPrefix` middleware do the
same. The Google deletion callback is then
`https://example.com/openbeacon/api/auth/google-deletion-callback`.

The `Deploy backend` GitHub Actions workflow also deploys the separate scheduled job runner. Every installation needs the runner: besides account deletion, it deletes expired email codes and verification tokens every hour, deletes new devices that weren't set up within 7 days or were removed more than 7 days ago, and deletes old device links and expired device challenges. See [the runner guide](../scheduled-jobs/README.md) for rollout and job requirements.

Publishing and deploying are separate workflows. Both use the
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets in the `production` GitHub
environment.

To publish, dispatch the `Publish images to Docker Hub` workflow from `main`.
It builds the backend, runner and map tiles images and pushes them to
`lspsoftware/openbeacon-backend`, `lspsoftware/openbeacon-scheduled-jobs` and
`lspsoftware/openbeacon-map-tiles`, tagged with `serverVersion` from
`src/version.ts`. It never moves `latest-stable` and never deploys. Re-running
it for the same commit skips images it already pushed, and it fails if that
version was already published from a different commit, so bump
`serverVersion` for every release.

To release, dispatch the `Deploy backend` workflow from `main`. It releases
`serverVersion` from `main` unless you enter another version, and fails if the
three images for that version aren't published yet. It points `latest-stable`
at that version for all three images. With "Trigger the Coolify deployment"
ticked, it then asks Coolify to deploy `latest-stable` to the
`OpenBeacon Backend` and `OpenBeacon Scheduled Jobs` applications, using the
`COOLIFY_ENDPOINT` and `COOLIFY_TOKEN` secrets; leave it unticked to deploy
from Coolify yourself later. It never redeploys `OpenBeacon Map Tiles`, because
a restart interrupts a map upload that can take hours: deploy it from Coolify
when `map-tiles status` shows no update running.

To roll back, dispatch `Deploy backend` with the earlier version and the
Coolify deployment ticked. For the first deployment, apply the Coolify
infrastructure plan and populate its environment variables before dispatching
the workflow. The workflow waits for Coolify to report the deployment result.
If polling fails or times out, check the deployment in Coolify before retrying.
Avoid starting other deployments manually while a workflow release is in
progress.

## Email

Email is optional. Without it the backend starts normally, sends nothing, and reports `email: false` from `auth.providers`. The app then hides the sign-up code, Forgot password, the recovery reset code and Account → Notifications → Email alerts. Users can't reset a forgotten password, and a recovery phrase reset needs only a fresh sign-in, a session linked to this phone, and typing `RESET`. That includes "Start fresh" when setting up a new phone: with email off, the account password is enough to set up a new phone without the recovery phrase. For an account that only uses Google, signing in with Google is enough. It deletes the account's encrypted history, and the new phone can see the family's locations from then on.

With email on, the backend sends codes for sign-up, email verification, password reset and recovery phrase reset, an "already have an account" email when someone signs up with a registered address, a "sign in with Google" email when someone asks to reset the password of an account that only uses Google, and security alerts. The alerts are always on for a password or recovery phrase change or reset, for other sessions being signed out, for a device being removed, for email alerts being turned off, and for account deletion. Users can turn off the new sign-in and deletion scheduled alerts in Account → Notifications → Email alerts.

To switch email on, configure one provider and a sender address in the root `.env`:

- Resend: verify your sending domain in Resend, then set `RESEND_API_KEY`. A sending-only key works. In the domain's settings in Resend, turn off open tracking and click tracking; with a full-access key the backend won't start while either is on. The hosted API uses Resend.
- SMTP: set `SMTP_HOST`, plus `SMTP_USER` and `SMTP_PASSWORD` if your server needs a login. `SMTP_PORT` defaults to `587`, where the backend requires STARTTLS and refuses to log in or send if the server doesn't offer it. Set `SMTP_SECURE=true` or `SMTP_PORT=465` for implicit TLS. For a local relay that only speaks plaintext, set `SMTP_REQUIRE_TLS=false`; credentials and emails then cross the network unencrypted.

Set `EMAIL_FROM` to the sender address, for example `noreply@example.com`. Emails always come from `OpenBeacon <EMAIL_FROM>`. A small "Sent from <SERVER_NAME>" line in the footer shows which server sent it. Setting both Resend and SMTP stops the backend from starting.

Emails are branded HTML with a plain-text part. The logo is attached to the email and shown inline, so nothing loads from the internet: there are no remote images, tracking pixels or click tracking.

At startup the backend checks the email settings without sending anything. For SMTP it connects and logs in. For Resend it checks the API key and, when the key has full access, that the `EMAIL_FROM` domain is verified in Resend with open tracking and click tracking off. A sending-only key passes the key check, but the domain and its tracking settings can't be checked with it, so check them yourself in Resend. A failed check stops the backend from starting.

Each address can request 3 codes of each kind every 15 minutes. `EMAIL_CODE_IP_LIMIT=true` also limits each IP address to 20 code requests an hour across all addresses, which slows down someone sending codes to many addresses from one machine. It is off by default because it can block users who share an IP address, such as phones behind carrier NAT or a household on one connection.

Each account can trigger at most 20 emails an hour. Over that cap, the new sign-in, deletion scheduled, "already have an account" and "sign in with Google" emails are dropped. Codes and the always-on alerts are still sent. The backend never logs email addresses or codes, except in the development console mode below.

For local development, set `EMAIL_CONSOLE=true` instead of a provider to print a one-line summary of each email to the log instead of sending it, for example `[email] to=alice@example.com type=password-reset code=123456`. It is refused unless `NODE_ENV` is `development` or `test`; the backend and runner `bun run dev` scripts set `NODE_ENV=development`.

Give the scheduled job runner the same email settings and `REDIS_URL`, so it can send the account deleted email at the end of the grace period. See [the runner guide](../scheduled-jobs/README.md).

### Switching email on later

Accounts created while email is off aren't verified. Once you switch email on, signing in with a password to one of those accounts sends a code to its address, and the owner enters it to finish signing in. Google sign-in isn't affected.

### What the email provider sees

Your email provider sees each recipient's address and every email in full: which kind it is, when it was sent, and the code or alert text. Emails never contain locations, IP addresses or recovery material. Anyone who can read an account's email can reset its password, unless it only signs in with Google. See [the privacy draft](../../docs/security/beta-1-privacy-draft.md#email).
