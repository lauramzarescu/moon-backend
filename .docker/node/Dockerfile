# Build stage
FROM node:22.4-alpine AS builder

RUN apk add --no-cache \
    git \
    wget curl \
    nginx \
    supervisor \
    postgresql-client \
    python3 \
    make \
    g++ \
    build-base

WORKDIR /build

# Copy only package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm ci --build-from-source

# Copy source code
COPY . .

# Generate Prisma types
RUN npm run prisma-types

# Production stage
FROM node:22.4-alpine

# Install only runtime dependencies
RUN apk add --no-cache \
    git \
    curl \
    nginx \
    supervisor \
    postgresql-client \
    && mkdir -p /var/lib/nginx/logs/ \
    && install -m 777 /dev/null /var/lib/nginx/logs/error.log \
    && chown -R nobody: /run/ /var/lib/nginx/ /var/log/nginx/ \
    && install -m 777 /dev/null /tmp/php_slow.log

WORKDIR /code

# Copy only necessary files from builder
COPY --from=builder --chown=node /build/node_modules /code/node_modules
COPY --from=builder --chown=node /build/package*.json /code/
COPY --from=builder --chown=node /build/dist /code/dist
#COPY --from=builder --chown=node /build/sc /code/prisma

# Copy application code (adjust paths as needed for your app structure)
COPY --chown=node . /code/

# Copy startup script
COPY .docker/node/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8000

ENTRYPOINT ["/start.sh"]
