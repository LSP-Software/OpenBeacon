import { describe, expect, test } from "bun:test";
import { signUpFormSchema } from "./signUpSchema.ts";

describe("signUpFormSchema", () => {
  const account = { name: "Alex", email: "alex@example.com", password: "password123" };

  test("accepts matching passwords", () => {
    expect(signUpFormSchema.safeParse({ ...account, confirmPassword: "password123" }).success).toBe(
      true,
    );
  });

  test("reports a mismatch on the confirmation field", () => {
    const result = signUpFormSchema.safeParse({ ...account, confirmPassword: "different" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["confirmPassword"], message: "Passwords do not match" }),
      );
    }
  });
});
