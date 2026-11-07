import { expect, test } from "bun:test";
import { FEEDBACK_MESSAGE_MAX_LENGTH, submitFeedbackSchema } from "./submitFeedback.ts";

test("limits feedback messages to the shared maximum after trimming", () => {
  const longest = "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH);
  expect(submitFeedbackSchema.parse({ message: ` ${longest} ` }).message).toBe(longest);
  expect(submitFeedbackSchema.safeParse({ message: `${longest}a` }).success).toBe(false);
  expect(submitFeedbackSchema.safeParse({ message: "   " }).success).toBe(false);
});

test("feedback emails are normalised to match account emails", () => {
  expect(submitFeedbackSchema.parse({ message: "hi", email: " User@Example.COM " }).email).toBe(
    "user@example.com",
  );
});
