#!/bin/sh
set -eu

iperf3 --server --daemon --pidfile /tmp/iperf3.pid
exec node server.mjs
