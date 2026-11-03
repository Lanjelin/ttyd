FROM ubuntu:24.04

LABEL org.opencontainers.image.title="ttyd-ng" \
      org.opencontainers.image.source="https://github.com/Lanjelin/ttyd-ng"

ARG TARGETARCH

# Dependencies
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Application
COPY ./dist/${TARGETARCH}/ttyd /usr/bin/ttyd

EXPOSE 7681
WORKDIR /root

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["ttyd", "-W", "bash"]
