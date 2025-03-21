# Variables
IMAGE_NAME = lauramzarescu/moon-v2-backend
VERSION = v1.0.6
DOCKERFILE = .docker/node/Dockerfile
PLATFORM = linux/amd64

# Default target
.PHONY: all
all: build

# Build the Docker image for a specific platform
.PHONY: build
build:
	docker build --platform $(PLATFORM) -t $(IMAGE_NAME):$(VERSION) --file $(DOCKERFILE) .

# Push the Docker image to the registry
.PHONY: push
push:
	docker push $(IMAGE_NAME):$(VERSION)

# Build and push in one command
.PHONY: build-push
build-push: build push

# Build for multiple platforms using buildx
.PHONY: build-multi
build-multi:
	docker buildx create --use --name multi-platform-builder || true
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):$(VERSION) --file $(DOCKERFILE) .

# Build and push for multiple platforms
.PHONY: build-push-multi
build-push-multi:
	docker buildx create --use --name multi-platform-builder || true
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):$(VERSION) --file $(DOCKERFILE) --push .

.PHONY: login
login:
	docker login

# Help command
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  build            - Build Docker image for $(PLATFORM)"
	@echo "  push             - Push Docker image to registry"
	@echo "  build-push      - Build and push Docker image"
	@echo "  build-multi     - Build for multiple platforms (amd64, arm64)"
	@echo "  build-push-multi - Build and push for multiple platforms"
	@echo "  login            - Login to Docker Hub"
	@echo ""
	@echo "Variables:"
	@echo "  IMAGE_NAME = $(IMAGE_NAME)"
	@echo "  VERSION = $(VERSION)"
	@echo "  DOCKERFILE = $(DOCKERFILE)"
	@echo "  PLATFORM = $(PLATFORM)"
