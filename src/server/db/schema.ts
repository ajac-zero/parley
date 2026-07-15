import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*  better-auth tables                                                        */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // admin plugin
  role: text("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // admin plugin
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [
    uniqueIndex("session_token_idx").on(t.token),
    index("session_user_id_idx").on(t.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* -------------------------------------------------------------------------- */
/*  Parley domain tables                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A registered Open Responses agent endpoint.
 * `ownerId = null` means the agent is global (visible to every user) and is
 * managed by admins. Otherwise it is a personal agent of that user.
 */
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    /** Short emoji or 1-2 letter monogram rendered as the agent avatar. */
    avatar: text("avatar"),
    /** Base URL of the Open Responses API, e.g. https://agent.example.com/v1 */
    baseUrl: text("base_url").notNull(),
    /**
     * A2A well-known agent card URL this agent was imported from
     * (https://{domain}/.well-known/agent-card.json). Null = manually added.
     * Kept so the agent can be re-synced from its card later.
     */
    cardUrl: text("card_url"),
    /** AES-256-GCM encrypted bearer token, base64. Null = no auth header. */
    apiKeyCiphertext: text("api_key_ciphertext"),
    /** Value for the `model` request field. */
    model: text("model"),
    /** Value for the `instructions` request field. */
    instructions: text("instructions"),
    /** How multi-turn context is sent: full item replay or previous_response_id. */
    continuation: text("continuation", {
      enum: ["replay", "previous_response_id"],
    })
      .notNull()
      .default("replay"),
    /**
     * How non-image files reach the agent. The configured mode is explicit;
     * Parley does not fall back between URL and inline delivery.
     */
    fileDelivery: text("file_delivery", {
      enum: ["url", "inline"],
    })
      .notNull()
      .default("url"),
    supportsImages: boolean("supports_images").notNull().default(false),
    supportsFiles: boolean("supports_files").notNull().default(false),
    /** Extra request params merged into the request body (temperature, reasoning, ...). */
    params: jsonb("params").$type<Record<string, unknown>>(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agents_owner_id_idx").on(t.ownerId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default("New chat"),
    /** Agent-side response id of the latest completed turn (previous_response_id mode). */
    lastResponseId: text("last_response_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("conversations_user_id_updated_idx").on(t.userId, t.updatedAt)],
);

/**
 * One agent invocation. A turn owns the user input items that triggered it
 * plus every output item the agent produced.
 */
export const turns = pgTable(
  "turns",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "pending",
        "streaming",
        "completed",
        "incomplete",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("pending"),
    /** The agent-side response id, once known. */
    responseId: text("response_id"),
    error: jsonb("error").$type<{ code?: string; message: string }>(),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("turns_conversation_id_idx").on(t.conversationId)],
);

/**
 * The transcript: an ordered list of Open Responses items. `payload` is the
 * verbatim item JSON so it can be replayed losslessly as request input.
 */
export const conversationItems = pgTable(
  "conversation_items",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").references(() => turns.id, {
      onDelete: "set null",
    }),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    source: text("source", { enum: ["user", "agent"] }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversation_items_conversation_seq_idx").on(
      t.conversationId,
      t.seq,
    ),
  ],
);

/** Uploaded attachment metadata; bytes live in S3-compatible object storage. */
export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    /** Object key within the configured S3 bucket. */
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("files_user_id_idx").on(t.userId)],
);

/** Single-row runtime settings blob, editable from the admin panel. */
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("default"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
