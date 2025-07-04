-- AlterTable
ALTER TABLE "Organization"
    ADD COLUMN "enforce2FA" BOOLEAN NOT NULL DEFAULT false;
