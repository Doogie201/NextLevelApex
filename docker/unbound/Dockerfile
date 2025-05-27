# Use a minimal Alpine Linux base image for arm64
FROM alpine:latest

# Install Unbound and bind-tools (for dig)
# Removed 'unbound-tools' as it's causing an issue. 'unbound' and 'bind-tools' should be sufficient.
RUN apk update && \
    apk add --no-cache unbound bind-tools && \
    rm -rf /var/cache/apk/*

# Create a dedicated directory for Unbound's mutable data (like root.key updates)
RUN mkdir -p /var/lib/unbound && \
    chown unbound:unbound /var/lib/unbound && \
    chmod 700 /var/lib/unbound

# Copy your Unbound configuration file into the container
COPY state/unbound.conf /etc/unbound/unbound.conf

# Copy root.hints from state/ to /etc/unbound/
COPY state/root.hints /etc/unbound/root.hints

# Expose the port Unbound will listen on (inside the container)
EXPOSE 5353/udp
EXPOSE 5353/tcp

# Set the entrypoint to run Unbound
ENTRYPOINT ["/usr/sbin/unbound"]
CMD ["-c", "/etc/unbound/unbound.conf", "-dv"]
