.PHONY: build frontend test format check clean

GOOS ?= linux
GOARCH ?= arm64

build: frontend
	mkdir -p dist
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -ldflags="-s -w" -o dist/openstick-webui .

frontend:
	cd frontend && npm ci --no-audit --no-fund && npm run build

test:
	go test -race ./...
	go vet ./...
	cd frontend && npx tsc --noEmit

format:
	gofmt -w *.go
	cd frontend && npx prettier --write src tests package.json tsconfig.json vite.config.ts playwright.config.ts index.html

check:
	go vet ./...
	cd frontend && npx prettier --check src

# Remove only generated build artifacts, never user configuration or state.
clean:
	go clean
