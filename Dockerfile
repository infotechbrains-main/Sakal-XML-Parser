# Use official Node.js image
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Copy the standalone output from build
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV production

# Start the app
CMD ["node", "server.js"]
