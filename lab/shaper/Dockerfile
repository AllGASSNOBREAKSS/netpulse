FROM alpine:3.22

RUN apk add --no-cache iproute2 socat wget
WORKDIR /lab
COPY entrypoint.sh apply-profile.sh ./
RUN chmod 0555 entrypoint.sh apply-profile.sh

EXPOSE 8080 5201 9000/udp
ENTRYPOINT ["./entrypoint.sh"]
