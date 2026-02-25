-- Chat messaging core tables for internal Team + DM chat.

DO $$ BEGIN
  CREATE TYPE "ChatConversationType" AS ENUM ('TEAM', 'DM', 'JOB_THREAD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'MEDIA', 'VOICE', 'LOCATION', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChatDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChatAttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'FILE', 'VOICE', 'LOCATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "ChatConversationType" NOT NULL,
  "title" TEXT,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "userAId" TEXT,
  "userBId" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_conversation_members" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT,
  "lastReadAt" TIMESTAMP(3),
  "mutedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
  "text" TEXT,
  "jobId" TEXT,
  "jobNumber" TEXT,
  "jobName" TEXT,
  "clientTempId" TEXT,
  "status" "ChatDeliveryStatus" NOT NULL DEFAULT 'SENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_message_attachments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "kind" "ChatAttachmentKind" NOT NULL,
  "url" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "durationMs" INTEGER,
  "thumbnailUrl" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_type_pinned_idx"
  ON "chat_conversations" ("tenantId", "type", "pinned");
CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_lastMessageAt_idx"
  ON "chat_conversations" ("tenantId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_pair_idx"
  ON "chat_conversations" ("tenantId", "userAId", "userBId");

CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_tenant_type_userAId_userBId_key"
  ON "chat_conversations" ("tenantId", "type", "userAId", "userBId");

-- Enforce a single TEAM conversation per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_team_per_tenant_unique"
  ON "chat_conversations" ("tenantId")
  WHERE "type" = 'TEAM';

CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversation_members_conversationId_userId_key"
  ON "chat_conversation_members" ("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "chat_conversation_members_tenant_user_idx"
  ON "chat_conversation_members" ("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "chat_conversation_members_tenant_conversation_idx"
  ON "chat_conversation_members" ("tenantId", "conversationId");

CREATE INDEX IF NOT EXISTS "chat_messages_tenant_conversation_createdAt_idx"
  ON "chat_messages" ("tenantId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "chat_messages_tenant_sender_createdAt_idx"
  ON "chat_messages" ("tenantId", "senderId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_conversation_sender_clientTempId_key"
  ON "chat_messages" ("conversationId", "senderId", "clientTempId");

CREATE INDEX IF NOT EXISTS "chat_message_attachments_tenant_message_idx"
  ON "chat_message_attachments" ("tenantId", "messageId");
