/**
 * The smudge tool's dab (smudge 01), fixed for now: its size and strength
 * become the artist's with their own controls.
 */

/** Dab radius in canvas pixels. */
export const SMUDGE_RADIUS = 16

/**
 * How much of the pixel one dab behind replaces the one under the tip. Below
 * one, so paint thins out as it is dragged instead of travelling for ever.
 */
export const SMUDGE_STRENGTH = 0.9

/**
 * Distance between dabs in canvas pixels. With the strength, this sets how
 * far paint is carried: each dab hands on that share of what the last one
 * brought, so a smear fades to about a third over forty pixels.
 */
export const SMUDGE_SPACING = 4
