# Beta 1 image access review

OPE-157 accepts unencrypted profile and group images for Beta 1. The hosted-service owner reports that images are stored in a public, non-browsable S3 bucket with random UUID filenames. This is owner-supplied configuration information, not an independent verification of the deployed bucket or CDN. Anyone who obtains a reachable image URL may be able to view it without signing in. Random filenames make URLs harder to guess; they do not provide authenticated access. Self-hosted behavior depends on its storage and CDN configuration.

## Source review

- Profile image upload requests require an authenticated session. Group image requests require an owner or admin, and group authorization is checked again when recording and confirming an upload. The API creates a random UUID filename and a five-minute presigned upload URL. The client uploads image bytes directly to storage, without end-to-end encryption. See `packages/api/src/router/accountRouter.ts`, `packages/api/src/router/group/groupSettingsRouter.ts`, `packages/api/src/lib/image-upload.ts` and `apps/mobile/lib/image-upload.ts`.
- The API saves an unsigned URL built from the configured CDN base, bucket and object key. The storage provider and operator can access image bytes; whether an unauthenticated request succeeds depends on deployment configuration. See `packages/api/src/lib/storage.ts`.
- On replacement, the API commits the new URL and attempts to delete the previous object, including listed object versions. Cleanup errors are ignored, so replacement does not guarantee removal. Superseded pending uploads are also cleaned up on a best-effort basis. A presigned upload may remain usable until it expires.
- Group deletion attempts to delete the current group image and pending group uploads before deleting the group record. Storage errors prevent successful group deletion, but CDN caches, backups and copies held by others are outside this source-level guarantee. No profile-image or account-deletion cleanup path was established by this review.

## Remaining verification

Confirm the actual hosted CDN and bucket access, caching, versioning and deletion behavior with a controlled image, including access without a session and behavior after replacement and group deletion. Check abandoned uploads and profile-image retention. Record results without publishing image URLs or credentials. The public disclosure in the README and website privacy page should be incorporated into the full beta privacy information under OPE-163; it is not a complete privacy policy.
