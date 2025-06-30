-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "resetTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "twoFactorResetToken" TEXT,
ADD COLUMN     "twoFactorResetTokenExpiry" TIMESTAMP(3);
