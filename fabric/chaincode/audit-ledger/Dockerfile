# Chaincode-as-a-Service image for the audit-ledger contract.
# The peer connects to this container over gRPC instead of building the
# chaincode itself (which the legacy builder cannot do on recent Docker).
FROM golang:1.21-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY vendor ./vendor
COPY *.go ./
RUN go build -mod=vendor -o /bin/chaincode .

FROM gcr.io/distroless/base-debian12
ARG CC_SERVER_PORT=9999
ENV PORT=${CC_SERVER_PORT}
COPY --from=build /bin/chaincode /bin/chaincode
EXPOSE ${CC_SERVER_PORT}
ENTRYPOINT ["/bin/chaincode"]
