-- Chat (v1): general room, messages, image attachments

CREATE TABLE "chat_rooms" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "chat_rooms_key_key" ON "chat_rooms"("key");

CREATE TABLE "chat_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "room_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "reply_to_message_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "chat_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "chat_messages_room_id_created_at_idx" ON "chat_messages"("room_id", "created_at");
CREATE INDEX "chat_messages_author_id_created_at_idx" ON "chat_messages"("author_id", "created_at");

CREATE TABLE "chat_attachments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message_id" TEXT,
  "type" TEXT NOT NULL DEFAULT 'image',
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "rel_path" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "chat_attachments_message_id_idx" ON "chat_attachments"("message_id");
