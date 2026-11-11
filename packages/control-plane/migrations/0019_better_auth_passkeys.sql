-- Better Auth passkey plugin 1.7.20. WebAuthn public credential material only;
-- private keys remain in authenticators and challenges remain in Better Auth's
-- expiring verification table.
CREATE TABLE IF NOT EXISTS "passkey" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "credentialID" text NOT NULL,
  "counter" integer NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" integer NOT NULL,
  "transports" text,
  "createdAt" date,
  "aaguid" text
);

CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("userId");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey" ("credentialID");
