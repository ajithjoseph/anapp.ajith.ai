# Launch a Day: one Node process, one SQLite file on a volume at /data.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3300 DATABASE_PATH=/data/launchaday.db SECURE_COOKIES=1 TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3300
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
