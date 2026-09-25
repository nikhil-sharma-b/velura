/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as brushes from "../brushes.js";
import type * as collection from "../collection.js";
import type * as collectionActions from "../collectionActions.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_brush from "../lib/brush.js";
import type * as lib_collection from "../lib/collection.js";
import type * as lib_documents from "../lib/documents.js";
import type * as lib_palette from "../lib/palette.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_retention from "../lib/retention.js";
import type * as palettes from "../palettes.js";
import type * as sessions from "../sessions.js";
import type * as shareLinks from "../shareLinks.js";
import type * as tiles from "../tiles.js";
import type * as tilesActions from "../tilesActions.js";
import type * as versions from "../versions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  brushes: typeof brushes;
  collection: typeof collection;
  collectionActions: typeof collectionActions;
  crons: typeof crons;
  documents: typeof documents;
  http: typeof http;
  "lib/branding": typeof lib_branding;
  "lib/brush": typeof lib_brush;
  "lib/collection": typeof lib_collection;
  "lib/documents": typeof lib_documents;
  "lib/palette": typeof lib_palette;
  "lib/r2": typeof lib_r2;
  "lib/retention": typeof lib_retention;
  palettes: typeof palettes;
  sessions: typeof sessions;
  shareLinks: typeof shareLinks;
  tiles: typeof tiles;
  tilesActions: typeof tilesActions;
  versions: typeof versions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
