import { expect, test } from "bun:test";

const signUrls = (env: Record<string, string>) => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `
        const { createSignedPmtilesUrl, mapStorageClient } = await import("${import.meta.dir}/mapStorage.ts");
        const { getPresignedUploadUrl } = await import("${import.meta.dir}/lib/storage.ts");
        const { s3Client } = await import("${import.meta.dir}/s3client.ts");
        const endpoint = async (client) => {
          const { hostname, port, protocol } = await client.config.endpoint();
          return protocol + "//" + hostname + (port ? ":" + port : "");
        };
        console.log(JSON.stringify({
          map: (await createSignedPmtilesUrl("planet-a.pmtiles")).url,
          mapClient: await endpoint(mapStorageClient),
          upload: await getPresignedUploadUrl("pictures", "groups", "a.webp", "image/webp", "aGFzaA==", 4),
          uploadClient: await endpoint(s3Client),
        }));
      `,
    ],
    env: {
      PATH: process.env["PATH"] ?? "",
      IMAGES_S3_ENDPOINT: "https://images.example.com",
      IMAGES_S3_REGION: "us-east-1",
      IMAGES_S3_ACCESS_KEY_ID: "images-key",
      IMAGES_S3_ACCESS_KEY: "images-secret",
      IMAGES_S3_BUCKET_NAME: "pictures",
      IMAGES_S3_FORCE_PATH_STYLE: "true",
      IMAGES_S3_CDN_URL: "https://images.example.com",
      MAP_S3_ENDPOINT: "https://map.example.com",
      MAP_S3_REGION: "us-east-1",
      MAP_S3_ACCESS_KEY_ID: "map-key",
      MAP_S3_ACCESS_KEY: "map-secret",
      MAP_S3_BUCKET_NAME: "map",
      MAP_S3_FORCE_PATH_STYLE: "true",
      ...env,
    },
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString()) as {
    map: string;
    mapClient: string;
    upload: string;
    uploadClient: string;
  };
};

test("phones get signed URLs for the public storage address while the server stays internal", () => {
  const urls = signUrls({
    IMAGES_S3_ENDPOINT: "http://storage:7070",
    IMAGES_S3_PUBLIC_ENDPOINT: "https://beacon.example.com",
    MAP_S3_ENDPOINT: "http://storage:7070",
    MAP_S3_PUBLIC_ENDPOINT: "https://beacon.example.com",
  });

  expect(urls.mapClient).toBe("http://storage:7070");
  expect(urls.uploadClient).toBe("http://storage:7070");
  expect(urls.map).toStartWith("https://beacon.example.com/map/planet-a.pmtiles?");
  expect(urls.upload).toStartWith("https://beacon.example.com/pictures/groups/a.webp?");
});

test("without public addresses, signed URLs use the storage endpoints", () => {
  const urls = signUrls({ IMAGES_S3_PUBLIC_ENDPOINT: "", MAP_S3_PUBLIC_ENDPOINT: " " });

  expect(urls.map).toStartWith("https://map.example.com/map/planet-a.pmtiles?");
  expect(urls.upload).toStartWith("https://images.example.com/pictures/groups/a.webp?");
});
