#!/bin/sh

npm run prisma-migration

npx ts-node src/prisma/seeds/local-init.seed.ts

npm run start