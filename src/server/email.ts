import { Context, Data, Effect, Layer } from "effect";
import { createTransport } from "nodemailer";

import { serverEnv } from "@/server/env";

/**
 * Outbound transactional email (verification, password reset). SMTP-only; there
 * is no silent log-to-console fallback. Missing SMTP configuration fails
 * server startup via `serverEnv()`, and tests replace the sender at the
 * Better Auth callback boundary.
 */
export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export class EmailDeliveryError extends Data.TaggedError("EmailDeliveryError")<{
  readonly reason: string;
}> {}

export class EmailService extends Context.Service<
  EmailService,
  { readonly send: (email: OutboundEmail) => Effect.Effect<void, EmailDeliveryError> }
>()("feastjourney/email/EmailService") {}

/** Plain async sender shared by the Effect service and Better Auth callbacks. */
export const sendOutboundEmail = async (email: OutboundEmail): Promise<void> => {
  const env = serverEnv();

  const transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
  });

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
};

export const EmailServiceLive = Layer.succeed(EmailService, {
  send: (email) =>
    Effect.tryPromise({
      try: () => sendOutboundEmail(email),
      catch: (cause) =>
        new EmailDeliveryError({
          reason: cause instanceof Error ? cause.message : "email delivery failed",
        }),
    }),
});
