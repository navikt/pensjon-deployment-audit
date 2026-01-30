# Build stage with full Node.js
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Compile TypeScript startup script to JavaScript
RUN npx tsc scripts/start-prod.ts --outDir scripts --module nodenext --moduleResolution nodenext --target es2022

# Production dependencies only
FROM node:24-bookworm-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Final stage with distroless
FROM gcr.io/distroless/nodejs24-debian12:nonroot

WORKDIR /app

# Copy package files
COPY --from=builder /app/package.json /app/package-lock.json ./

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/build ./build

# Copy migration files and config
COPY --from=builder /app/app/db/migrations ./app/db/migrations
COPY --from=builder /app/.node-pg-migrate.json ./

# Copy compiled startup script
COPY --from=builder /app/scripts/start-prod.js ./scripts/

# Expose port (adjust based on your app)
EXPOSE 3000

# Run startup script that does migrations + starts server
CMD ["scripts/start-prod.js"]
