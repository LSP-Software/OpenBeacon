import { env } from "../env.ts";

type B2AuthResponse = {
  authorizationToken: string;
  apiInfo: {
    storageApi: {
      apiUrl: string;
    };
  };
};

type B2UploadUrlResponse = {
  uploadUrl: string;
  authorizationToken: string;
};

let cachedAuth: { data: B2AuthResponse; expiresAt: number } | null = null;

export async function authorizeB2(): Promise<B2AuthResponse> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return cachedAuth.data;
  }

  const credentials = Buffer.from(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`, "utf8").toString(
    "base64",
  );
  const response = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`B2 authorization failed: ${body || response.status}`);
  }

  const data = (await response.json()) as B2AuthResponse;
  cachedAuth = { data, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return data;
}

function clearAuthCache(): void {
  cachedAuth = null;
}

export async function getUploadUrl(): Promise<B2UploadUrlResponse> {
  const authData = await authorizeB2();
  const apiUrl = authData.apiInfo.storageApi.apiUrl;

  const response = await fetch(`${apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: "POST",
    headers: {
      Authorization: authData.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
  });

  if (response.status === 401) {
    clearAuthCache();
    return getUploadUrl();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`B2 get upload URL failed: ${body || response.status}`);
  }

  return response.json() as Promise<B2UploadUrlResponse>;
}

export async function fileExists(fileName: string): Promise<boolean> {
  const url = `${env.B2_PUBLIC_URL}/${fileName}`;
  console.log("Checking if file exists:", url);

  try {
  const response = await fetch(url, { method: "HEAD" });

    console.log("Response:", response);
    return response.ok;
  } catch (err) {
    console.error("Error checking if file exists:", err);
    return false;
  }
}

export async function verifyB2Connectivity(): Promise<void> {
  try {
    await authorizeB2();
    console.log("Backblaze B2: connectivity OK");
  } catch (err) {
    console.error("Backblaze B2: connectivity check failed –", err);
    process.exit(1);
  }
}
