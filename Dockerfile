# syntax=docker/dockerfile:1
# マルチステージビルド（research.md R-18）：UI ビルド → サーバービルド → JRE 実行
# ビルドはインターネットに接続できる環境で事前に行う（docker compose build）。

FROM node:22 AS ui-build
WORKDIR /build/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

FROM maven:3-eclipse-temurin-21 AS server-build
WORKDIR /build/server
COPY server/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY server/src ./src
COPY --from=ui-build /build/ui/dist ./src/main/resources/static
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=server-build /build/server/target/demo-server.jar ./demo-server.jar
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/demo-server.jar"]
