#!/bin/sh
set -eu

sysctl -w net.ipv4.ip_forward=1 >/dev/null
./apply-profile.sh \
  "${DEFAULT_DOWNLOAD_MBPS:-100}" \
  "${DEFAULT_UPLOAD_MBPS:-20}" \
  "${DEFAULT_RTT_MS:-20}" \
  "${DEFAULT_JITTER_MS:-0}" \
  "${DEFAULT_LOSS_PCT:-0}" \
  "${DEFAULT_QUEUE_PACKETS:-1000}"

socat TCP-LISTEN:8080,reuseaddr,fork TCP:"${ENDPOINT_HOST}":8080 &
socat TCP-LISTEN:5201,reuseaddr,fork TCP:"${ENDPOINT_HOST}":5201 &
socat UDP4-RECVFROM:9000,reuseaddr,fork UDP4-SENDTO:"${ENDPOINT_HOST}":9000 &
wait
