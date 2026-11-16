import { beforeEach, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { dismissAlert, getSnapshot } from "./alert.ts";

const listKey = ["groupMembership", "list"];
const queryClient = new QueryClient();
let upload: () => Promise<{ data: string } | { error: string }> = async () => ({ data: "" });

mock.module("./api.ts", () => ({
  queryClient,
  trpc: { groupMembership: { list: { queryKey: () => listKey } } },
  trpcClient: {},
}));

mock.module("./imageKeys.ts", () => ({ confirmGroupImage: async () => ({ imageUrl: "" }) }));

mock.module("./image-upload.ts", () => ({
  imageUploadErrorMessage: () => "This phone is still catching up with this group.",
  uploadImageFromUri: () => upload(),
}));

const { uploadNewGroupImage } = await import("./groupImageUpload.ts");

beforeEach(() => {
  while (getSnapshot().length) dismissAlert();
  queryClient.setQueryData(listKey, [
    { id: "group-1", image: null },
    { id: "group-2", image: null },
  ]);
});

test("shows the new picture on the created group once it uploads", async () => {
  upload = async () => ({ data: "https://images.example/group-1.bin" });

  await uploadNewGroupImage({ groupId: "group-1", uri: "file://picture.webp" });

  expect(queryClient.getQueryData<unknown>(listKey)).toEqual([
    { id: "group-1", image: "https://images.example/group-1.bin" },
    { id: "group-2", image: null },
  ]);
  expect(getSnapshot()).toEqual([]);
});

test("tells the person the group exists when the upload fails", async () => {
  upload = async () => ({ error: "Too many uploads. Wait a minute and try again." });

  await uploadNewGroupImage({ groupId: "group-1", uri: "file://picture.webp" });

  expect(getSnapshot().map(({ title, message }) => ({ title, message }))).toEqual([
    {
      title: "Group created, but the picture couldn’t be uploaded",
      message:
        "Too many uploads. Wait a minute and try again. You can set it from the group screen.",
    },
  ]);
  expect(queryClient.getQueryData<unknown>(listKey)).toEqual([
    { id: "group-1", image: null },
    { id: "group-2", image: null },
  ]);
});

test("does not throw when the upload throws", async () => {
  upload = async () => {
    throw new Error("network");
  };

  await uploadNewGroupImage({ groupId: "group-1", uri: "file://picture.webp" });

  expect(getSnapshot()[0]?.message).toBe(
    "This phone is still catching up with this group. You can set it from the group screen.",
  );
});
