-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('TOTP', 'YUBIKEY', 'ANY');

-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "twoFactorMethod" "TwoFactorMethod" DEFAULT 'TOTP';

-- CreateTable
CREATE TABLE "YubikeyInfo"
(
    "id"        TEXT         NOT NULL,
    "publicId"  TEXT         NOT NULL,
    "nickname"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed"  TIMESTAMP(3),
    "userId"    TEXT         NOT NULL,

    CONSTRAINT "YubikeyInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YubikeyInfo_publicId_key" ON "YubikeyInfo" ("publicId");

-- AddForeignKey
ALTER TABLE "YubikeyInfo"
    ADD CONSTRAINT "YubikeyInfo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
