#!/bin/sh

export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?schema=public"
export NODE_OPTIONS=--max-old-space-size=4096

npm run prisma-migration

node dist/prisma/seeds/local-init.seed.js

npm run start