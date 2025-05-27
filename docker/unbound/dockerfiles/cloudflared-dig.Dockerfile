# Stage 1 – pick a minimal Alpine userland
FROM alpine:3.19

# Install dig/nslookup AND grab the latest cloudflared static binary
RUN set -e \
 && apk add --no-cache bind-tools curl ca-certificates \
 && curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
      -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared

# Provide a simple health-probe inside the image (optional but handy)
HEALTHCHECK CMD dig @127.0.0.1 cloudflare.com -p 5053 +short || exit 1

ENTRYPOINT ["cloudflared"]
CMD ["--help"]   # real args are supplied from docker-compose.yml
