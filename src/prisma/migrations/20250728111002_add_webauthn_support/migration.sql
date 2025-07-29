-- AlterTable
ALTER TABLE "YubikeyInfo"
    ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'OTP',
ADD COLUMN     "counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credentialBackedUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "credentialDeviceType" TEXT,
ADD COLUMN     "credentialId" TEXT,
ADD COLUMN     "credentialPublicKey" BYTEA,
ADD COLUMN     "transports" TEXT[];

-- CreateIndex
CREATE INDEX "YubikeyInfo_credentialId_idx" ON "YubikeyInfo" ("credentialId");

-- CreateIndex
CREATE INDEX "YubikeyInfo_authType_idx" ON "YubikeyInfo" ("authType");
