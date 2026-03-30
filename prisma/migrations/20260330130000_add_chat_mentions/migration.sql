-- Chat mentions: @login tagging with per-user unread

CREATE TABLE "chat_mentions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seen_at" DATETIME,
  CONSTRAINT "chat_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "chat_mentions_message_id_user_id_key" ON "chat_mentions"("message_id","user_id");
CREATE INDEX "chat_mentions_user_id_seen_at_created_at_idx" ON "chat_mentions"("user_id","seen_at","created_at");

