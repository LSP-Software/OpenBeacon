# Self-hosted object storage research

Research date: 2026-11-14. Sources are the projects' own repositories, wikis, release pages, advisory lists and container registries. Where a point comes from reading source code, the commit is given. Versity Gateway v1.11.0 was then tested against OpenBeacon in `self-host/docker-compose.yml`; see [Test results](#test-results).

## Verdict

Not blocked. **Versity Gateway (`versitygw`) with its POSIX backend** meets every requirement for both buckets in a single container. It is Apache-2.0, has had releases every few weeks through 2026, ships images on Docker Hub and GHCR, makes no outbound calls of its own, and takes its root credentials from environment variables. It has two gaps. Buckets, versioning and the public-read policy need a one-shot init container, and OpenBeacon needs small code changes: a configurable map-tiles endpoint and path-style addressing.

The fallback is **SeaweedFS**. It meets the feature list, but its usage reporting is on by default and must be switched off with a flag. It also has a much larger stream of security advisories.

MinIO itself is out: the repository was archived on 25 April 2026, and the official image is gone. Garage, s3proxy (filesystem backend) and Zenko CloudServer each fail a hard requirement. RustFS and the Silo fork of MinIO both work, but each carries a trust risk explained below.

## What OpenBeacon needs

- Image bucket (`packages/api/src/lib/storage.ts`, `apps/scheduled-jobs/src/jobs/imageUploadCleanup.ts`):
  - Presigned SigV4 PUT that signs `content-type` and `x-amz-checksum-sha256`, with the server rejecting a checksum mismatch.
  - HeadObject, ranged GetObject and DeleteObject.
  - Versioning: ListObjectVersions with `VersionIdMarker` paging, delete markers and `NextKeyMarker`, plus DeleteObjects with a `VersionId`.
  - Anonymous public GET at `${S3_CDN_URL}/${bucket}/${key}`.
- Map tiles bucket (`apps/map-tiles/src/upload.ts`, `packages/map-tiles/src/manifestStore.ts`, `packages/api/src/r2.ts`):
  - Multipart upload of multi-GB archives, including ListMultipartUploads and ListParts.
  - PutObject with `If-Match` or `If-None-Match: *`, enforced with a 412.
  - Ranged GET, HEAD, ListObjectsV2, DeleteObject, and presigned GET with a 10-minute expiry.

## Comparison

"Yes (src)" means confirmed in source at the commit named in the notes. "Docs" means only the project's own documentation says so.

|                                                  | Versity Gateway                                           | SeaweedFS                                                    | Silo (MinIO fork)                        | RustFS                                   | Garage                                             | s3proxy (filesystem) | Zenko CloudServer                |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------- | -------------------------------------------------- | -------------------- | -------------------------------- |
| Presigned PUT + SHA-256 checksum enforced        | Yes (src)                                                 | Yes (src)                                                    | Inherited from MinIO, not checked        | Not checked                              | Checksum code exists; versioning missing anyway    | Not checked          | Checksum validation exists (src) |
| Versioning + ListObjectVersions                  | Yes, POSIX `--versioning-dir` (docs, releases)            | Yes (src, docs)                                              | Yes (upstream MinIO feature)             | Yes (README)                             | **No** (docs, src)                                 | **No** (README)      | Yes (README)                     |
| Conditional PUT (`If-Match`, `If-None-Match: *`) | Yes, atomic since v1.8.0 (src, releases)                  | Yes (src)                                                    | Yes (src)                                | Yes (src, releases)                      | **No** (no PutObject precondition in src)          | Yes                  | **No** (none found in `lib/`)    |
| Multipart                                        | Yes                                                       | Yes                                                          | Yes                                      | Yes                                      | Yes                                                | Yes                  | Yes                              |
| Anonymous read without listing                   | Bucket policy `Principal: "*"` + `s3:GetObject`           | Bucket policy or anonymous identity with `Read` only         | Bucket policy (`download`)               | Bucket policy                            | Website endpoint only                              | Not checked          | Bucket policy                    |
| Licence                                          | Apache-2.0, no CLA                                        | Apache-2.0, no CLA                                           | AGPL-3.0, no CLA                         | Apache-2.0, **CLA allows relicensing**   | AGPL-3.0                                           | Apache-2.0           | Apache-2.0                       |
| Outbound calls by default                        | None found                                                | **Usage reporting on by default**                            | Upstream phone-home removed (src)        | **Update check on by default**           | None (OTLP only if configured)                     | Not checked          | Not checked                      |
| Credentials from env                             | `ROOT_ACCESS_KEY`, `ROOT_SECRET_KEY`                      | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `s3.json`    | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` | `GARAGE_DEFAULT_*` (single-node)                   | Yes                  | `SCALITY_ACCESS_KEY_ID`          |
| Buckets, versioning, policy at start             | Init container                                            | Buckets via `weed mini -bucket`; the rest via init container | Init container                           | Init container                           | Default bucket only                                | n/a                  | Init container                   |
| Health endpoint                                  | `--health /health` (unauthenticated GET, 200)             | `/healthz`, `/status`                                        | `/minio/health/live`                     | Not checked                              | `garage health` CLI, admin `/health`               | Not checked          | Not checked                      |
| Healthcheck binary in image                      | Alpine base, so busybox `wget` (inferred from Dockerfile) | `curl`                                                       | `curl`                                   | Alpine base                              | None (`FROM scratch`); `garage health` can be used | Not checked          | Not checked                      |

## Versity Gateway

- **Project and maintenance.** Maintained by Versity Software, which offers paid support. The repo is Apache-2.0 ([repo](https://github.com/versity/versitygw)). Recent releases are v1.11.0 (6 Nov 2026), v1.10.0 (22 Oct), v1.9.0 (13 Oct), v1.8.0 (4 Sep) and v1.7.0 (15 Jul) ([releases](https://github.com/versity/versitygw/releases)). From August to mid-November 2026, 16 authors committed, led by benmcclelland (47) and niksis02 (23) (GitHub commits API). There is no CLA.
- **Security record.** The [advisory list](https://github.com/versity/versitygw/security/advisories) has 10 advisories. The most serious:
  - Critical (Jul 2026): pre-auth LDAP filter injection. It only matters with LDAP IAM, which OpenBeacon would not use.
  - High (Jul 2026): CopyObject path traversal on POSIX.
  - High (Oct 2026): path traversal through upload IDs and DeleteObjects keys.
  - High (Nov 2026): presigned requests redirectable to another bucket.

  All were published with fixes. The traversal fixes also appear in the v1.9.0 notes ([releases](https://github.com/versity/versitygw/releases)).

- **Images.** Published as `versity/versitygw` on Docker Hub and `ghcr.io/versity/versitygw`, built by `.github/workflows/docker.yml` ([Docker wiki](https://github.com/versity/versitygw/wiki/Docker)). Docker Hub showed `v1.11.0` and `latest` pushed on 2026-11-10. The image is `FROM alpine:latest` (`Dockerfile` at f13a323), so busybox `wget` should be available for a healthcheck. That is inferred, not run.
- **Image bucket requirements.**
  - **Checksums.** The POSIX PutObject path wraps the body in a hash reader for the requested algorithm and returns `BadDigest` on mismatch (`backend/posix/posix.go`, `s3api/utils/csum-reader.go` at f13a323). v1.5.0 added SHA-512, MD5 and xxHash on top of the existing algorithms ([releases](https://github.com/versity/versitygw/releases)).
  - **Versioning.** Needs the gateway flag `--versioning-dir` (or `VGW_VERSIONING_DIR`), on a directory outside the gateway root, plus `PutBucketVersioning` on each bucket. Old versions are kept in a shadow tree, and delete markers are an xattr ([POSIX versioning](https://github.com/versity/versitygw/wiki/POSIX-versioning)). v1.11.0 fixed version listing after markers and HeadObject on delete markers.
  - **Public read.** A bucket policy with `"Principal": "*"` covers unauthenticated requests. Listing needs a separate `s3:ListBucket` grant on the bucket ARN, so a `s3:GetObject`-only policy should leave listing closed ([Bucket Policies](https://github.com/versity/versitygw/wiki/Bucket-Policies)). Since v1.9.0, every anonymous action is authorised ([releases](https://github.com/versity/versitygw/releases)).
- **Map tiles requirements.** PutObject and CompleteMultipartUpload call `checkPutPreconditions` with `IfMatch` and `IfNoneMatch`, and v1.8.0 made the check atomic with publication (`backend/posix/posix.go`; [releases](https://github.com/versity/versitygw/releases)). Multipart parts are staged under `<bucket>/.sgwtmp`, with a default limit of 10,000 parts ([POSIX Backend](https://github.com/versity/versitygw/wiki/POSIX-Backend)).
- **Filesystem.** The default metadata store needs xattrs, and the gateway checks for them at start-up ([POSIX Backend](https://github.com/versity/versitygw/wiki/POSIX-Backend)). Docker volumes on ext4 or xfs should qualify. An existing top-level directory shows up as a bucket ([POSIX Backend](https://github.com/versity/versitygw/wiki/POSIX-Backend)), but versioning and the policy still have to be set through the API.
- **Telemetry.** Searching for hard-coded external URLs in `cmd`, `s3api`, `backend`, `auth` and `metrics` found none. Metrics are push-only to StatsD or DogStatsD servers you configure (`--metrics-statsd-servers`, `--metrics-dogstatsd-servers` in `cmd/versitygw/main.go`). The admin API and web UI only listen when their ports are set.
- **Declarative setup.**
  - The entrypoint reads `VGW_BACKEND=posix`, `VGW_BACKEND_ARGS`, `ROOT_ACCESS_KEY`, `ROOT_SECRET_KEY` and `VGW_VERSIONING_DIR` ([Docker wiki](https://github.com/versity/versitygw/wiki/Docker); `docker-entrypoint.sh`).
  - Nothing creates buckets at start-up. The wiki's own quickstart runs `aws s3 mb` by hand ([Docker wiki](https://github.com/versity/versitygw/wiki/Docker)). A one-shot init container would run CreateBucket, PutBucketVersioning and PutBucketPolicy, and should ignore "already exists" errors.
- **Health.** With `--health /health` (or `VGW_HEALTH`), an unauthenticated GET returns 200 `OK`. That path can no longer be used as a bucket name ([HealthCheck](https://github.com/versity/versitygw/wiki/HealthCheck)).

## SeaweedFS

- **Project and maintenance.** Apache-2.0. Releases came quickly: 4.49 (23 Oct 2026) to 4.53 (8 Nov) ([releases](https://github.com/seaweedfs/seaweedfs/releases)). From August 2026, 19 authors committed, but chrislusf wrote 65 of the commits, so most of the work rests on one person (GitHub commits API). Images are `chrislusf/seaweedfs` on Docker Hub and `ghcr.io/chrislusf/seaweedfs` (`.github/workflows/container_release_unified.yml`). The final stage installs `curl` (`docker/Dockerfile.go_build` at 4fc4187).
- **Security record.** The [advisory list](https://github.com/seaweedfs/seaweedfs/security/advisories) runs to six pages. Page one alone has ten advisories published on 9 Nov 2026, two of them critical. Several hit features OpenBeacon would use:
  - Anonymous ListObjectsV2 bypassing a bucket-policy Deny on public-read buckets.
  - Stored XSS through response-header overrides on public-read buckets.
  - The S3 gateway's gRPC port exposing IAM admin without auth when no filer signing key is set.
- **Telemetry.** **On by default.** `weed master`, `weed server` and `weed mini` send version, OS, a random topology ID, volume-server count, disk bytes and volume count to `https://telemetry.seaweedfs.com/api/collect`. Reporting starts once a minimum amount of data is stored. Disable it with `-telemetry=false`, or `-master.telemetry=false` on `server` and `mini` (`weed/command/master.go:134-135`, `weed/command/server.go:116-117`, `weed/telemetry/collector.go`, `telemetry/proto/telemetry.proto`).
- **Image bucket requirements.**
  - **Checksums.** A checksum header, or one hoisted into the query string, is detected and compared after upload. A mismatch deletes the stored chunks and returns `BadDigest` (`weed/s3api/s3api_object_handlers_put.go:930-941, 1653-1693`). The versioned PUT path uses the same `putToFiler`.
  - **Versioning.** Supported, including `VersionIdMarker` and `NextVersionIdMarker` (`weed/s3api/s3api_object_versioning.go`; [S3 API wiki](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)).
  - **Public read.** Possible through a bucket policy (`AuthWithPublicRead` in `s3api_bucket_handlers.go`), or an identity with `Read` but not `List` ([S3 Configuration](https://github.com/seaweedfs/seaweedfs/wiki/S3-Configuration)).
  - **Default access.** The zero-config server allows anonymous access and defaults to Allow ([S3 Configuration](https://github.com/seaweedfs/seaweedfs/wiki/S3-Configuration)), so credentials must always be configured.
- **Map tiles requirements.** PutObject runs `checkConditionalHeaders`, which covers `If-None-Match: *` and ETag lists (`s3api_object_handlers_put.go:121, 2861-2910`; 4.50 notes).
- **Declarative setup.** Credentials come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (`weed/s3api/auth_credentials.go:556`) or an `s3.json`. `weed mini -bucket` (or `S3_BUCKET`) creates buckets at start (`weed/command/mini.go:417, 1673`), but `mini` describes itself as for "small/dev use cases" (`mini.go:346`). Versioning and policy still need an init container.
- **Health.** `/healthz`, `/status` and `/readyz` on the S3 port (`s3api_server.go:980-996`).
- **Weight.** The deployment is a master, a volume server, a filer and the S3 gateway, either combined in `weed server -s3` or run separately. That is more moving parts than Versity's one process over a directory.

## MinIO and the Silo fork

- **Upstream MinIO.** The README says "THIS REPOSITORY IS NO LONGER MAINTAINED". The repo was archived on 2026-04-24 or 25 (GitHub API `archived: true`, `pushed_at` 2026-04-24), and community releases are source-only ([repo](https://github.com/minio/minio)). The last tag is `RELEASE.2025-10-15T17-29-55Z`. `hub.docker.com/v2/repositories/minio/minio/` returned 404 on 2026-11-14. The README points to "AIStor Free", which has a proprietary licence, not an open-source one. Ruled out.
- **Silo.** A fork of the MinIO server by PGSTY, under AGPL-3.0 with no CLA. It says it is maintenance only, removes upstream phone-home, and publishes `docker.io/pgsty/silo` ([repo](https://github.com/pgsty/silo); `CONTRIBUTING.md`). The latest release is 2026-11-12. In source, callhome is "retained for compatibility; diagnostic uploads are disabled in Silo" (`cmd/config-current.go:101` at d660200). The image ships a static `curl` (`Dockerfile.goreleaser`). PutObject preconditions are in `cmd/object-handlers.go:2623-2641`.
- **Risk.** From May 2026, 94 of 100 commits were by one person (Vonng) (GitHub commits API). It would be a good fit feature-wise, but it has a single maintainer on an inherited codebase.

## RustFS

- Apache-2.0. 1.0.0 shipped on 16 Sep 2026 and 1.0.5 on 10 Nov ([releases](https://github.com/rustfs/rustfs/releases)). The image is `rustfs/rustfs` on Docker Hub. The default credentials are `rustfsadmin` / `rustfsadmin` ([README](https://github.com/rustfs/rustfs)).
- **Telemetry.** The README's comparison table claims "No Telemetry". In source, however, an update check to `https://version.rustfs.com/latest.json` runs at start-up by default. `RUSTFS_CHECK_UPDATE=false` turns it off (`rustfs/src/update.rs:101`, `rustfs/src/init.rs:78-86`, `crates/config/src/constants/console.rs:115-118` at ebe31df). A "RustFS Connect" registration client exists, but it only runs when `RUSTFS_CONNECT_ENDPOINT` is set (`rustfs/src/connect/config.rs`).
- **Licensing risk.** `CLA.md` grants RustFS the right to relicense contributions "under any license, including proprietary or commercial licenses". That is the same arrangement that let MinIO change course.
- **Security record.** The [advisory list](https://github.com/rustfs/rustfs/security/advisories) runs to five pages. It includes "Unsigned x-amz-* headers honored on presigned uploads" (Sep 2026), which bears directly on OpenBeacon's signed checksum header, and "PutObject with ?versionId= overwrites object versions" (Oct 2026).
- Not recommended until it has a longer track record.

## Ruled out on features

- **Garage** (AGPL-3.0, Deuxfleurs). It is a healthy project at 2.5.0, but versioning is missing: GetBucketVersioning is a stub, and ListObjectVersions and PutBucketVersioning are not implemented ([S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/); `src/api/s3/api_server.rs` at ed3befd). The only preconditions in `src/api/s3` are copy-source and GET ones, so PutObject has no `If-Match` or `If-None-Match`. There are no bucket policies; public read works only through the website endpoint. It would need both the versioning fallback and a different manifest locking design.
- **s3proxy** (Apache-2.0). The `filesystem` backend has "no object versioning" ([README](https://github.com/gaul/s3proxy), issue #1138).
- **Zenko CloudServer** (Apache-2.0, Scality; 9.5.5 on 12 Nov 2026). Searching `lib/` at fe1c6d2 found no `If-Match` or `If-None-Match` handling for PutObject, so map-tiles manifest locking would not be enforced. Unverified: whether its `arsenal` dependency adds this. Its images are on GHCR (`.github/workflows/release.yaml`).
- **Ceph RGW.** Not evaluated in depth. Running MON, OSD and RGW daemons to serve two small buckets is far heavier than this stack needs.

## Changes needed in OpenBeacon

Status on 2026-11-14:

1. **Configurable storage.** Done on main: `MAP_S3_*` and `IMAGES_S3_*` replace the hard-coded R2 endpoint. `*_S3_FORCE_PATH_STYLE=true` gives path-style addressing, which Versity needs unless `VGW_VIRTUAL_DOMAIN` and wildcard DNS are set up.
2. **Public addresses.** Done on this branch: `IMAGES_S3_PUBLIC_ENDPOINT` and `MAP_S3_PUBLIC_ENDPOINT`. Phones get links signed for the public HTTPS address, while the server reaches storage at `http://storage:7070`.
3. **One domain through Caddy.**
   - `/openbeacon-pictures/*` and `/openbeacon-map/*` go to Versity, and everything else goes to the backend. The backend serves only `/health` and `/api/*`.
   - Caddy keeps the original `Host`, so signatures still match.
   - On the storage paths, Caddy only allows `GET`, `HEAD` and `PUT` and refuses an `Authorization` header. That is a second layer behind the bucket policy.
4. **Init container.** A one-shot `curlimages/curl` container (about 11 MB, using curl's built-in SigV4 signing) creates both buckets, enables versioning on the pictures bucket and applies the `s3:GetObject`-only policy. Every step is safe to repeat. An earlier version used `amazon/aws-cli`, a 654 MB image whose default checksum behaviour has changed between releases before.
5. **No versioning fallback needed.** Versity, SeaweedFS and Silo all support versioning. A fallback would only matter for Garage.

## Test results

Run on 2026-11-14 with `self-host/docker-compose.yml`, Versity Gateway v1.11.0 with fsync on, Dragonfly v2.1.0, PostgreSQL 18 and locally built OpenBeacon 0.21.0 images. The `.env` file was filled in as the quick start describes. Requests from the host went through Caddy on a single `beacon.localhost` domain, where the two bucket paths go to Versity and everything else goes to the backend. Checks inside the stack called the real OpenBeacon functions.

- Map tiles bucket:
  - The map-tiles start-up access check passed.
  - `uploadArchive` sent a 150 MB archive as a multipart upload.
  - Ranged GETs returned the right bytes, both inside the stack and through a presigned URL via Caddy.
  - `writeManifest` enforced `If-None-Match: *`, a wrong `If-Match` and a stale `If-Match`. Of 10 concurrent writes on the same ETag, exactly one succeeded.
- Picture bucket:
  - A presigned PUT with the wrong bytes for the signed checksum returned 400 `BadDigest`.
  - A changed checksum header or content type returned 403 `SignatureDoesNotMatch`. The correct upload returned 200.
  - Anonymous GET of a picture worked. Anonymous listing, version listing, ListBuckets and PUT returned 403.
  - A truncated `ListObjectVersions` returned `NextKeyMarker` and `NextVersionIdMarker`. `deleteImageKey` removed every version and delete marker.
- Versity checks the region in SigV4 signatures, so `MAP_S3_REGION` and `IMAGES_S3_REGION` must match `VGW_REGION`.
- The server signs phone links for `IMAGES_S3_PUBLIC_ENDPOINT` and `MAP_S3_PUBLIC_ENDPOINT` while it reaches storage on the internal network. Caddy keeps the Host header, so the signatures still match.
- The image has `/usr/bin/wget`, which the Docker healthcheck uses.
- Data survived `docker compose down` and `up`.

Not tested: a phone on a real network, Cloudflare Tunnel, Let's Encrypt issuance, and a full planet download.
