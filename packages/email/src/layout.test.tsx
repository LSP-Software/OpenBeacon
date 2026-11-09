import { describe, expect, test } from "bun:test";
import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";

const render = () =>
  renderEmailLayout({
    serverName: "Family Server",
    preview: "Your OpenBeacon sign-up code",
    children: <Text>Your code is 123456.</Text>,
  });

describe("renderEmailLayout", () => {
  test("wraps the body in the shared footer", async () => {
    const { html, text } = await render();
    expect(text).toContain("Your code is 123456.");
    expect(text).toContain(
      "We will never ask for your recovery phrase. Don't share it with anyone, including us.",
    );
    expect(text).toContain("Sent from Family Server");
    expect(html).toContain("Your code is 123456.");
    expect(html).toContain("We will never ask for your recovery phrase.");
    expect(html).toContain("Family Server");
  });

  test("requires preview text so mail apps don't preview the body", async () => {
    await expect(
      renderEmailLayout({ serverName: "Family Server", preview: " ", children: <Text>Body</Text> }),
    ).rejects.toThrow("Email preview text is required");
  });

  test("keeps the preview text out of the plain-text part", async () => {
    const { html, text } = await render();
    expect(html).toContain("Your OpenBeacon sign-up code");
    expect(text).not.toContain("Your OpenBeacon sign-up code");
  });

  test("loads nothing remotely and attaches the logo inline", async () => {
    const { html, text, attachments } = await render();
    expect(html).toContain('src="cid:openbeacon-logo"');
    expect(html).not.toMatch(/(src|href|background)=["']?https?:/i);
    expect(html).not.toMatch(/url\(/i);
    expect(text).not.toContain("cid:");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.contentId).toBe("openbeacon-logo");
    expect(attachments[0]?.content.subarray(1, 4).toString()).toBe("PNG");
    expect(attachments[0]?.content.readUInt32BE(16)).toBe(96);
  });
});
