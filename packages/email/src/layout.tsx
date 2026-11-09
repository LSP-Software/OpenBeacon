import { readFileSync } from "node:fs";
import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import type { ReactNode } from "react";
import type { EmailMessage } from "./types.ts";

const emailColors = {
  brand: "#ff1463",
  header: "#0a0911",
  text: "#1a1523",
  muted: "#6b6478",
  faint: "#8f889b",
  border: "#e8e4ef",
};

const logo = readFileSync(new URL("./assets/logo.png", import.meta.url));

export const renderEmailLayout = async ({
  serverName,
  preview,
  children,
  footerNote,
}: {
  serverName: string;
  preview: string;
  children: ReactNode;
  footerNote?: string;
}): Promise<Pick<EmailMessage, "html" | "text" | "attachments">> => {
  if (!preview.trim()) throw new Error("Email preview text is required");
  const fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const email = (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#ffffff", margin: 0, padding: 0, fontFamily }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto" }}>
          <Section
            style={{
              backgroundColor: emailColors.header,
              borderBottom: `3px solid ${emailColors.brand}`,
              padding: "20px 24px",
            }}
          >
            <Row>
              <Column style={{ width: "44px" }}>
                <Img
                  src="cid:openbeacon-logo"
                  width="32"
                  height="32"
                  alt=""
                  style={{ display: "block" }}
                />
              </Column>
              <Column>
                <Text
                  style={{
                    color: "#ffffff",
                    fontSize: "20px",
                    fontWeight: 700,
                    letterSpacing: "-0.2px",
                    lineHeight: "32px",
                    margin: 0,
                  }}
                >
                  OpenBeacon
                </Text>
              </Column>
            </Row>
          </Section>
          <Section
            style={{
              color: emailColors.text,
              fontSize: "16px",
              lineHeight: "24px",
              padding: "32px 24px",
            }}
          >
            {children}
          </Section>
          <Section
            style={{ borderTop: `1px solid ${emailColors.border}`, padding: "16px 24px 32px" }}
          >
            {footerNote && (
              <Text
                style={{
                  color: emailColors.muted,
                  fontSize: "13px",
                  lineHeight: "20px",
                  margin: "0 0 8px",
                }}
              >
                {footerNote}
              </Text>
            )}
            <Text
              style={{ color: emailColors.muted, fontSize: "13px", lineHeight: "20px", margin: 0 }}
            >
              We will never ask for your recovery phrase. Don't share it with anyone, including us.
            </Text>
            <Text
              style={{
                color: emailColors.faint,
                fontSize: "12px",
                lineHeight: "18px",
                margin: "8px 0 0",
              }}
            >
              Sent from {serverName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);
  return {
    html,
    text,
    attachments: [{ filename: "openbeacon.png", content: logo, contentId: "openbeacon-logo" }],
  };
};
