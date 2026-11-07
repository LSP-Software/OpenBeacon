import { describe, expect, test } from "bun:test";
import { changePasswordFormSchema } from "./changePasswordSchema.ts";

describe("changePasswordFormSchema", () => {
  const issuesFor = (values: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }) => {
    const result = changePasswordFormSchema.safeParse(values);
    return result.success ? [] : result.error.issues;
  };

  test("accepts a valid change", () => {
    expect(
      issuesFor({
        currentPassword: "oldpassword",
        newPassword: "newpassword123",
        confirmNewPassword: "newpassword123",
      }),
    ).toEqual([]);
  });

  test("requires the current password", () => {
    expect(
      issuesFor({
        currentPassword: "",
        newPassword: "newpassword123",
        confirmNewPassword: "newpassword123",
      }),
    ).toContainEqual(expect.objectContaining({ path: ["currentPassword"] }));
  });

  test("applies the sign up password rules to the new password", () => {
    expect(
      issuesFor({
        currentPassword: "oldpassword",
        newPassword: "short",
        confirmNewPassword: "short",
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["newPassword"],
        message: "Password must be at least 8 characters long",
      }),
    );
  });

  test("reports a mismatch on the confirmation field", () => {
    expect(
      issuesFor({
        currentPassword: "oldpassword",
        newPassword: "newpassword123",
        confirmNewPassword: "newpassword124",
      }),
    ).toContainEqual(
      expect.objectContaining({ path: ["confirmNewPassword"], message: "Passwords do not match" }),
    );
  });

  test("rejects reusing the current password", () => {
    expect(
      issuesFor({
        currentPassword: "samepassword",
        newPassword: "samepassword",
        confirmNewPassword: "samepassword",
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["newPassword"],
        message: "New password must be different from your current password",
      }),
    );
  });
});
