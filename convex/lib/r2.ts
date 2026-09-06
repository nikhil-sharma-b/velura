import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// R2's S3-compatible endpoint is derived from the account id — no separate
// endpoint or public-domain env var to keep in sync. Reads go through
// presigned GETs rather than a public bucket URL: the bucket has public
// access disabled, and the free dev `.r2.dev` subdomain is rate-limited and
// not meant for real traffic.
function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  })
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

function bucket(): string {
  return requireEnv("R2_BUCKET_NAME")
}

export function tileKey(hash: string): string {
  return `tiles/${hash}`
}

export function previewKey(documentId: string): string {
  return `previews/${documentId}.png`
}

const PRESIGN_TTL_SECONDS = 15 * 60

export async function presignTilePut(hash: string): Promise<string> {
  return await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: tileKey(hash) }),
    { expiresIn: PRESIGN_TTL_SECONDS }
  )
}

export async function presignTileGet(hash: string): Promise<string> {
  return await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: tileKey(hash) }),
    { expiresIn: PRESIGN_TTL_SECONDS }
  )
}

export async function presignPreviewPut(documentId: string): Promise<string> {
  return await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: previewKey(documentId),
      ContentType: "image/png",
    }),
    { expiresIn: PRESIGN_TTL_SECONDS }
  )
}

export async function presignPreviewGet(documentId: string): Promise<string> {
  return await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: previewKey(documentId) }),
    { expiresIn: PRESIGN_TTL_SECONDS }
  )
}
