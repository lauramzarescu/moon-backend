#!/bin/sh

export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?schema=public"
export NODE_OPTIONS=--max-old-space-size=4096

npm run prisma-migration

npx ts-node src/prisma/seeds/local-init.seed.ts

npm run start