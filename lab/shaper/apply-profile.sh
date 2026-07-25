#!/bin/sh
set -eu

DOWNLOAD_MBPS="${1:?download Mbps is required}"
UPLOAD_MBPS="${2:?upload Mbps is required}"
RTT_MS="${3:?round-trip latency is required}"
JITTER_MS="${4:?jitter is required}"
LOSS_PCT="${5:?packet loss is required}"
QUEUE_PACKETS="${6:?queue size is required}"

validate_number() {
  value="$1"
  label="$2"
  echo "$value" | grep -Eq '^[0-9]+([.][0-9]+)?$' || { echo "$label must be numeric" >&2; exit 2; }
}

for pair in "$DOWNLOAD_MBPS:download" "$UPLOAD_MBPS:upload" "$RTT_MS:rtt" "$JITTER_MS:jitter" "$LOSS_PCT:loss" "$QUEUE_PACKETS:queue"; do
  validate_number "${pair%%:*}" "${pair#*:}"
done

CLIENT_IF="$(ip -o -4 addr show | awk '$4 ~ /^172[.]29[.]0[.]/ {print $2; exit}')"
SERVER_IF="$(ip -o -4 addr show | awk '$4 ~ /^172[.]30[.]0[.]/ {print $2; exit}')"
[ -n "$CLIENT_IF" ] && [ -n "$SERVER_IF" ] || { echo "lab interfaces were not found" >&2; exit 3; }

ONE_WAY_MS="$(awk -v rtt="$RTT_MS" 'BEGIN { printf "%.3f", rtt / 2 }')"
ONE_WAY_JITTER="$(awk -v jitter="$JITTER_MS" 'BEGIN { printf "%.3f", jitter / 2 }')"

apply() {
  interface="$1"
  rate="$2"
  tc qdisc replace dev "$interface" root netem \
    rate "${rate}mbit" \
    delay "${ONE_WAY_MS}ms" "${ONE_WAY_JITTER}ms" distribution normal \
    loss random "${LOSS_PCT}%" \
    limit "$QUEUE_PACKETS"
}

# Response payload exits toward the client; request/upload payload exits toward
# the endpoint. Splitting delay across the two egress paths controls total RTT.
apply "$CLIENT_IF" "$DOWNLOAD_MBPS"
apply "$SERVER_IF" "$UPLOAD_MBPS"

printf '{"downloadMbps":%s,"uploadMbps":%s,"roundTripMs":%s,"jitterMs":%s,"packetLossPct":%s,"queuePackets":%s}\n' \
  "$DOWNLOAD_MBPS" "$UPLOAD_MBPS" "$RTT_MS" "$JITTER_MS" "$LOSS_PCT" "$QUEUE_PACKETS"
