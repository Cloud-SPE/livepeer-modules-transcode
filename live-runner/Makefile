.PHONY: test test-container race vet fmt

test:
	go test ./...

test-container:
	LIVE_RUNNER_CONTAINER_TEST=1 go test -run TestMediaMTXImageAcceptsGeneratedConfig ./...

race:
	go test -race ./...

vet:
	go vet ./...

fmt:
	gofmt -w *.go
