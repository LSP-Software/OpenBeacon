import { expect, test } from "bun:test";
import { buildGroupAvatarPath, buildUserAvatarPath } from "./image-upload.ts";

test("image upload paths belong to the uploader", () => {
  const userId = "user-1";
  expect(buildUserAvatarPath(userId)).toBe("user/user-1/uploads/avatar");
  expect(buildGroupAvatarPath(userId, "group-1")).toBe("user/user-1/uploads/group/group-1/avatar");
  expect(buildGroupAvatarPath("user-2", "group-1")).not.toBe(
    buildGroupAvatarPath(userId, "group-1"),
  );
});
