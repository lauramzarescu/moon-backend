-- CreateTable
CREATE TABLE "ServiceRepository"
(
    "id"             TEXT         NOT NULL,
    "serviceArn"     TEXT         NOT NULL,
    "owner"          TEXT         NOT NULL,
    "repo"           TEXT         NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT         NOT NULL,

    CONSTRAINT "ServiceRepository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRepository_organizationId_serviceArn_key" ON "ServiceRepository" ("organizationId", "serviceArn");

-- AddForeignKey
ALTER TABLE "ServiceRepository"
    ADD CONSTRAINT "ServiceRepository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
