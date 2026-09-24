FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime

ENV NODE_ENV=production \
    WA_SESSION_DIR=/data/session \
    HEALTH_PORT=3000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /data/session && chown -R node:node /app /data

USER node
VOLUME ["/data/session"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
