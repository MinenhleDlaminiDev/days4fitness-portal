# The build context is the repository ROOT, not backend/. The migration runner
# resolves migrations to <repo>/database/migrations relative to backend/src/db,
# so the image has to carry database/ alongside backend/ and keep both in the
# same relative positions the repository uses. Northflank: build context "/",
# Dockerfile location "/backend/Dockerfile".
FROM node:24-alpine

WORKDIR /app

# Dependencies first so a source-only change does not reinstall them.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src
COPY database/migrations ./database/migrations

# Runs unprivileged. The node image ships this user; nothing here is written to
# at runtime, so read-only ownership is enough.
USER node

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["npm", "start"]
