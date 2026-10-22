/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminAuth from "../adminAuth.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as auth_google from "../auth/google.js";
import type * as billing from "../billing.js";
import type * as billingStore from "../billingStore.js";
import type * as calendar_config from "../calendar/config.js";
import type * as calendar_connections from "../calendar/connections.js";
import type * as calendar_http from "../calendar/http.js";
import type * as calendar_providers_google from "../calendar/providers/google.js";
import type * as calendar_providers_registry from "../calendar/providers/registry.js";
import type * as calendar_providers_types from "../calendar/providers/types.js";
import type * as calendar_secrets from "../calendar/secrets.js";
import type * as calendar_sync from "../calendar/sync.js";
import type * as chat from "../chat.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as meetings from "../meetings.js";
import type * as orgAuth from "../orgAuth.js";
import type * as organizations from "../organizations.js";
import type * as schedule from "../schedule.js";
import type * as signaling from "../signaling.js";
import type * as site from "../site.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminAuth: typeof adminAuth;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  "auth/google": typeof auth_google;
  billing: typeof billing;
  billingStore: typeof billingStore;
  "calendar/config": typeof calendar_config;
  "calendar/connections": typeof calendar_connections;
  "calendar/http": typeof calendar_http;
  "calendar/providers/google": typeof calendar_providers_google;
  "calendar/providers/registry": typeof calendar_providers_registry;
  "calendar/providers/types": typeof calendar_providers_types;
  "calendar/secrets": typeof calendar_secrets;
  "calendar/sync": typeof calendar_sync;
  chat: typeof chat;
  cleanup: typeof cleanup;
  crons: typeof crons;
  http: typeof http;
  identity: typeof identity;
  meetings: typeof meetings;
  orgAuth: typeof orgAuth;
  organizations: typeof organizations;
  schedule: typeof schedule;
  signaling: typeof signaling;
  site: typeof site;
  users: typeof users;
  utils: typeof utils;
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
