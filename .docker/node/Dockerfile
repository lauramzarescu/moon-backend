# Build stage
FROM node:22.4-alpine AS builder

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    build-base

WORKDIR /build

# Copy only package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies (build from source for native modules like bcrypt)
RUN npm ci --build-from-source

# Copy source code
COPY . .

# Generate Prisma types and build TypeScript
RUN npm run prisma-types && npm run build

# Runtime stage (minimal)
FROM node:22.4-alpine

WORKDIR /code

# Copy production artifacts and dependencies from builder
COPY --from=builder --chown=node /build/node_modules /code/node_modules
COPY --from=builder --chown=node /build/package*.json /code/
COPY --from=builder --chown=node /build/dist /code/dist

# Copy only what is needed at runtime (seed script relies on TS source)
COPY --chown=node src/prisma /code/src/prisma

# Copy email templates
COPY --chown=node src/templates /code/src/templates

# Startup script
COPY .docker/node/start.sh /start.sh
RUN chmod +x /start.sh

# Drop privileges
USER node

EXPOSE 8000

ENTRYPOINT ["/start.sh"]
