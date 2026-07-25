FROM node:22-bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends iperf3 tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/netpulse-lab
COPY server.mjs entrypoint.sh healthcheck.mjs ./
RUN chmod 0555 entrypoint.sh

EXPOSE 8080 5201 9000/udp
ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
