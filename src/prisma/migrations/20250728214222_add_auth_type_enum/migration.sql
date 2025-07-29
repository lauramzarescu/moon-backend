/*
  Warnings:

  - The `authType` column on the `YubikeyInfo` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('OTP', 'WEBAUTHN');

-- AlterTable
ALTER TABLE "YubikeyInfo" DROP COLUMN "authType",
ADD COLUMN     "authType" "AuthType" NOT NULL DEFAULT 'OTP';

-- CreateIndex
CREATE INDEX "YubikeyInfo_authType_idx" ON "YubikeyInfo" ("authType");
