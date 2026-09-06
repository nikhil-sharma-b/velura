import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import type { StoredTileObject, TileObjectPage } from "./collection"

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

const TILE_PREFIX = "tiles/"
// R2 caps a listing page at 1000 keys, which is also the cap on a batched
// delete — so one page in is one delete call out, and the sweep never has to
// hold the whole bucket in memory.
const LIST_PAGE_SIZE = 1000

/**
 * One page of the tile bucket, oldest-known-first only insofar as R2 orders by
 * key; the sweep does not depend on the order, only on seeing every object
 * exactly once per run.
 */
export async function listTileObjects(
  cursor: string | undefined
): Promise<TileObjectPage> {
  const response = await client().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: TILE_PREFIX,
      MaxKeys: LIST_PAGE_SIZE,
      ContinuationToken: cursor,
    })
  )
  const objects: StoredTileObject[] = []
  for (const item of response.Contents ?? []) {
    const key = item.Key
    if (key === undefined || !key.startsWith(TILE_PREFIX)) continue
    const hash = key.slice(TILE_PREFIX.length)
    // A key with a slash after the prefix is not a tile this app wrote;
    // leaving it alone costs nothing and deleting it is unrecoverable.
    if (hash.length === 0 || hash.includes("/")) continue
    objects.push({
      hash,
      size: item.Size ?? 0,
      // An object with no reported time is treated as brand new, so the grace
      // window protects it rather than the sweep guessing it is ancient.
      uploadedAt: item.LastModified?.getTime() ?? Date.now(),
    })
  }
  return {
    objects,
    cursor: response.IsTruncated ? response.NextContinuationToken : undefined,
  }
}

/**
 * Deletes tile objects by hash. Content addressing makes this idempotent: a
 * key that is already gone deletes cleanly, so an interrupted sweep can be
 * replayed without special-casing what it had already done.
 */
export async function deleteTileObjects(
  hashes: readonly string[]
): Promise<void> {
  if (hashes.length === 0) return
  await client().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: {
        Objects: hashes.map((hash) => ({ Key: tileKey(hash) })),
        Quiet: true,
      },
    })
  )
}
