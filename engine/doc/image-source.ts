/**
 * The picture a placed image was made from, and the one place it is turned
 * into pixels (06).
 *
 * A placed image keeps the file it came from. That is what lets a transform
 * be a change to a description rather than a change to pixels: every commit
 * draws the original at the placement now in force, so a photograph moved and
 * scaled a dozen times is exactly as sharp as one moved and scaled once. The
 * file's own bytes are kept, not a decoded buffer — a JPEG is a tenth of the
 * size of the rgba16float tiles it produces, which is what keeps a document
 * that holds its originals a defensible size on disk.
 *
 * The decoding is the platform's, behind the interface below; the drawing is
 * the renderer's, from the texture this hands it. Nothing between them turns
 * a picture into pixels on the CPU, which is what makes dragging a large
 * photograph interactive rather than a slideshow.
 */

import type { ImagePlacement } from "./image-placement"
/** An image as a browser hands one over: non-premultiplied sRGB, 8 bits. */
export type SourceImage = {
  readonly width: number
  readonly height: number
  /** Row-major RGBA, four bytes a pixel — an `ImageData.data`. */
  readonly pixels: Uint8ClampedArray | Uint8Array
}

/**
 * An original picture as the document keeps one: the encoded file, its id
 * (its content hash, so the same photo placed twice is stored once), and the
 * size it decodes to, which is what "how much detail is left" is measured
 * against without decoding anything.
 */
export type ImageAsset = Readonly<{
  id: string
  /** The media type the bytes are encoded in, e.g. `image/jpeg`. */
  mime: string
  bytes: Uint8Array
  /** Intrinsic size of the decoded picture, in its own pixels. */
  width: number
  height: number
}>

/** An asset without its bytes: what a manifest and a layer tree carry. */
export type ImageAssetRef = Readonly<Omit<ImageAsset, "bytes">>

/**
 * An original, decoded and held open.
 *
 * A drag is a run of adjustments, and decoding the file again for each one
 * would mean a full JPEG decode per pointer sample: the picture would trail
 * the hand dragging it. The decode happens once when the picture is picked
 * up, every adjustment draws from it, and it is let go of at the end — which
 * costs nothing in fidelity, since each drawing is still made from the
 * original rather than from the drawing before it.
 */
export interface OpenImage {
  /**
   * The decoded picture itself, for a caller that can draw it without going
   * through pixels — the renderer uploads this straight into a texture, so a
   * drag never converts a pixel on the CPU at all (06).
   */
  readonly source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas
  /** Lets go of the decoded picture. Rendering after this is not allowed. */
  close(): void
}

export interface ImageSourceCodec {
  /** The size an encoded picture decodes to. */
  measure(
    bytes: Uint8Array,
    mime: string
  ): Promise<{
    width: number
    height: number
  }>
  /**
   * Decodes an original and holds it open. Every drawing taken from it is a
   * single resampling of the original, whatever the placement has been
   * through — which is the whole of why a picture does not soften as it is
   * adjusted (06).
   */
  open(asset: ImageAsset): Promise<OpenImage>
  /**
   * Raw pixels as an encoded file. The way in for a picture that never was
   * one — pixels handed straight to `placeImage` — so that such an image has
   * an original to be transformed from like any other.
   */
  encode(image: SourceImage): Promise<{ bytes: Uint8Array; mime: string }>
}

/** The id an asset is stored under: its content, so identical files share one. */
export function assetId(bytes: Uint8Array): string {
  // The tile store's mix, over a file's bytes rather than a tile's texels.
  // Content addressing for the same reason tiles have it: the same photo
  // placed twice costs one blob, and a blob once written is never stale.
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0
    b = Math.imul(b + bytes[i] + i, 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}${bytes.length.toString(16)}`
}

/**
 * A layer's picture: the original it was made from and where that original
 * sits. This is what an image layer holds instead of only pixels, and what a
 * transform changes — one description, adjusted, rather than pixels resampled
 * onto pixels (06).
 */
export type PlacedImage = Readonly<{
  asset: ImageAssetRef
  placement: ImagePlacement
}>
