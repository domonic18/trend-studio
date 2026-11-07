# 构建上下文是 monorepo 根目录（pnpm workspace），不是 apps/cloud。
# 先只拷各包的清单装依赖，再拷源码构建，避免源码改动触发整轮重装。
#
#   docker build -f apps/cloud/Dockerfile -t trend-coach-cloud .
#   docker compose -f apps/cloud/docker-compose.prod.yml up -d --build
#
# 依赖用 pnpm 装（仓库锁定 pnpm@9.15.9），不再用 npm——workspace:* 依赖
# npm 无法解析，且 apps/coach 的依赖不在本镜像范围内。
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/package.json
COPY apps/coach/package.json apps/coach/package.json
COPY apps/producer/package.json apps/producer/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/widgets/package.json packages/widgets/package.json
# ... 选云端应用及其工作区依赖（契约与渲染组件包）。
RUN pnpm install --frozen-lockfile --filter trend-coach-cloud...
COPY apps/cloud apps/cloud
COPY packages packages
RUN pnpm --filter @trend/contracts build \
 && pnpm --filter @trend/widgets build \
 && pnpm --filter trend-coach-cloud build

# 运行期依赖单独一版：只装生产依赖，镜像里不留 tsc/vite。
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/package.json
COPY apps/coach/package.json apps/coach/package.json
COPY apps/producer/package.json apps/producer/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/widgets/package.json packages/widgets/package.json
RUN pnpm install --frozen-lockfile --prod --filter trend-coach-cloud...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# 管线在 runtime 直接 spawn ffmpeg/ffprobe；预建 /data 目录供容器直接运行。
RUN apk add --no-cache ffmpeg \
 && mkdir -p /data/storage /data/hls \
 && chown -R node:node /data
WORKDIR /app
# pnpm 的隔离布局靠相对符号链接串起来：.pnpm 实际存储 + 各包的 node_modules
# 必须保持同一棵相对目录，链接才解析得到。
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/cloud/node_modules /app/apps/cloud/node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=prod-deps /app/packages/widgets/node_modules /app/packages/widgets/node_modules
# 工作区包在运行期被云端按包名 import（契约是 zod schema 的单一真相），
# 需带上构建产物 lib/。
COPY --from=build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /app/packages/contracts/lib /app/packages/contracts/lib
COPY --from=build /app/packages/widgets/package.json /app/packages/widgets/package.json
COPY --from=build /app/packages/widgets/lib /app/packages/widgets/lib
COPY --from=build /app/apps/cloud/package.json /app/apps/cloud/package.json
COPY --from=build /app/apps/cloud/dist /app/apps/cloud/dist
COPY --from=build /app/apps/cloud/migrations /app/apps/cloud/migrations
COPY --from=build /app/apps/cloud/content /app/apps/cloud/content
COPY --from=build /app/apps/cloud/data /app/apps/cloud/data
USER node
WORKDIR /app/apps/cloud
EXPOSE 3939
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT??3939)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
