import Resend from "@auth/core/providers/resend"
import { convexAuth } from "@convex-dev/auth/server"
import { Resend as ResendClient } from "resend"

import { APP_NAME } from "./lib/branding"

const CODE_LENGTH = 8
const CODE_ALPHABET = "0123456789"
const CODE_LIFETIME_SECONDS = 60 * 15

/**
 * 256 is not a multiple of 10, so `byte % 10` would make the digits 0-5 about a
 * fifth likelier than 6-9 and cost roughly a third of a bit per digit. Bytes at
 * or above the largest multiple of 10 are therefore redrawn rather than folded.
 */
export function generateEmailCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length)
  const digits: string[] = []
  const byte = new Uint8Array(1)
  while (digits.length < CODE_LENGTH) {
    crypto.getRandomValues(byte)
    if (byte[0] < limit)
      digits.push(CODE_ALPHABET[byte[0] % CODE_ALPHABET.length])
  }
  return digits.join("")
}

/**
 * Email one-time code (D8). No password is ever stored, hashed or transported,
 * so a leak of this table costs an attacker a code that expires in 15 minutes.
 */
const EmailCode = Resend({
  id: "email-code",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: CODE_LIFETIME_SECONDS,

  async generateVerificationToken() {
    return generateEmailCode()
  },

  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendClient(provider.apiKey)
    const { error } = await resend.emails.send({
      from:
        process.env.AUTH_EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`,
      to: [email],
      subject: `Your ${APP_NAME} sign-in code`,
      text: `Your ${APP_NAME} sign-in code is ${token}. It expires in 15 minutes.`,
    })
    if (error)
      throw new Error(
        `Could not send the sign-in code: ${JSON.stringify(error)}`
      )
  },
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [EmailCode],
})
