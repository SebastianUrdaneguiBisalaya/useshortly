FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/api ./cmd/api

# tursogo loads prebuilt native libraries at runtime (purego), so the image needs
# glibc: use debian-slim, not scratch/alpine.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app \
    && mkdir /data && chown app /data
USER app
ENV DATABASE_PATH=/data/useshortly.db
COPY --from=build /out/api /usr/local/bin/api
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["api"]
