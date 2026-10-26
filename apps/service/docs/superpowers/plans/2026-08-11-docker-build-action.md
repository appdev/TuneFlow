# Docker Build Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the repository's current source-code changes with a GitHub Actions job that builds the production Docker image, starts it, and proves it becomes healthy.

**Architecture:** A single GitHub Actions workflow uses Docker Buildx to build and load the existing `Dockerfile` as a local amd64 image. A subsequent shell step runs the image with an isolated Docker volume, polls Docker's built-in health status with a fixed timeout, prints diagnostics on failure, and always removes the test resources.

**Tech Stack:** GitHub Actions, Docker Buildx, Docker Engine, Node.js 22 project tests, Git, GitHub CLI.

## Global Constraints

- Include all currently modified and untracked source-code files under `src/`.
- Add `.github/workflows/docker-build.yml`.
- Exclude `data/`, `dist/`, `docs/flutter-ui-api-matrix.md`, `TuneFlow.png`, `._TuneFlow.png`, and the local `docs/superpowers/` process documents from publication.
- Do not publish a container image or change deployment infrastructure.
- Target `main` from a dedicated branch and open a draft pull request.

---

### Task 1: Add the Docker build and health-check workflow

**Files:**
- Create: `.github/workflows/docker-build.yml`

**Interfaces:**
- Consumes: the repository-root `Dockerfile`, whose image exposes port `3124` and defines a Docker health check against `/api/v1/health`.
- Produces: a CI job named `docker-build` that builds `tuneflow-server-web:ci` and fails unless its container reaches Docker health status `healthy`.

- [ ] **Step 1: Verify the workflow does not already exist**

Run:

```bash
test ! -e .github/workflows/docker-build.yml
```

Expected: exit status 0. If the file exists, inspect it and stop before overwriting unrelated content.

- [ ] **Step 2: Create the workflow**

Create `.github/workflows/docker-build.yml` with this content:

```yaml
name: Docker build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  docker-build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      CI_CONTAINER: tuneflow-ci-${{ github.run_id }}-${{ github.run_attempt }}
      CI_IMAGE: tuneflow-server-web:ci
      CI_VOLUME: tuneflow-ci-data-${{ github.run_id }}-${{ github.run_attempt }}
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          platforms: linux/amd64
          push: false
          tags: ${{ env.CI_IMAGE }}

      - name: Start container
        run: |
          docker volume create "$CI_VOLUME"
          docker run --detach \
            --name "$CI_CONTAINER" \
            --volume "$CI_VOLUME:/data" \
            "$CI_IMAGE"

      - name: Wait for healthy container
        shell: bash
        run: |
          for attempt in {1..30}; do
            status="$(docker inspect --format '{{.State.Health.Status}}' "$CI_CONTAINER")"
            if [[ "$status" == healthy ]]; then
              exit 0
            fi
            if [[ "$(docker inspect --format '{{.State.Status}}' "$CI_CONTAINER")" == exited ]]; then
              docker logs "$CI_CONTAINER"
              exit 1
            fi
            sleep 2
          done
          docker logs "$CI_CONTAINER"
          exit 1

      - name: Print container logs on failure
        if: failure()
        run: docker logs "$CI_CONTAINER" || true

      - name: Clean up container resources
        if: always()
        run: |
          docker rm --force --volumes "$CI_CONTAINER" || true
          docker volume rm "$CI_VOLUME" || true
```

- [ ] **Step 3: Validate workflow syntax and contract**

Run:

```bash
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/docker-build.yml', aliases: true)"
rg -n "push:|pull_request:|workflow_dispatch:|docker/build-push-action@v6|load: true|push: false|State.Health.Status|if: always\(\)" .github/workflows/docker-build.yml
```

Expected: Ruby exits 0 and `rg` prints every required workflow behavior.

### Task 2: Verify the approved source tree and Docker runtime

**Files:**
- Verify: `src/renderer/utils/musicSdk/wy/index.js`
- Verify: `src/renderer/utils/musicSdk/wy/albumSearch.js`
- Verify: `src/server/api/openapi.test.ts`
- Verify: `src/server/api/schemas/domain.ts`
- Verify: `src/server/downloads/manager.ts`
- Verify: `src/server/downloads/types.ts`
- Verify: `src/server/tuneFlowSdk/index.ts`
- Verify: `src/server/routes/catalog.test.ts`
- Verify: `src/server/routes/catalog.ts`
- Verify: `src/server/sources/source.test.ts`
- Verify: `src/server/sources/types.ts`
- Verify: `src/server/sources/worker-host.ts`
- Verify: `Dockerfile`

**Interfaces:**
- Consumes: the current approved source changes and the new workflow from Task 1.
- Produces: test evidence that the source suite passes and `tuneflow-server-web:local-check` builds and reaches `healthy` locally.

- [ ] **Step 1: Run the repository test suite**

Run:

```bash
npm test
```

Expected: Vitest and Node build-configuration tests exit 0 with no failed tests.

- [ ] **Step 2: Build the production Docker image locally**

Run:

```bash
docker build --tag tuneflow-server-web:local-check .
```

Expected: Docker exits 0 after completing `npm run build:service`, the `better-sqlite3` runtime probe, and `npm run verify:service-isolated` from the Dockerfile.

- [ ] **Step 3: Start the image with isolated resources**

Run:

```bash
docker volume create tuneflow-local-check-data
docker run --detach --name tuneflow-local-check --volume tuneflow-local-check-data:/data tuneflow-server-web:local-check
```

Expected: Docker prints the volume name and new container ID.

- [ ] **Step 4: Wait for the local container to become healthy**

Run:

```bash
for attempt in {1..30}; do
  status="$(docker inspect --format '{{.State.Health.Status}}' tuneflow-local-check)"
  if [[ "$status" == healthy ]]; then
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Status}}' tuneflow-local-check)" == exited ]]; then
    docker logs tuneflow-local-check
    exit 1
  fi
  sleep 2
done
test "$(docker inspect --format '{{.State.Health.Status}}' tuneflow-local-check)" = healthy
```

Expected: the final `test` exits 0 within 60 seconds.

- [ ] **Step 5: Remove local verification resources**

Run:

```bash
docker rm --force --volumes tuneflow-local-check
docker volume rm tuneflow-local-check-data
```

Expected: Docker reports removal of both resources. If verification failed, print `docker logs tuneflow-local-check` before cleanup.

### Task 3: Publish the approved code in a draft pull request

**Files:**
- Stage: `.github/workflows/docker-build.yml`
- Stage: `src/renderer/utils/musicSdk/wy/index.js`
- Stage: `src/renderer/utils/musicSdk/wy/albumSearch.js`
- Stage: `src/server/api/openapi.test.ts`
- Stage: `src/server/api/schemas/domain.ts`
- Stage: `src/server/downloads/manager.ts`
- Stage: `src/server/downloads/types.ts`
- Stage: `src/server/tuneFlowSdk/index.ts`
- Stage: `src/server/routes/catalog.test.ts`
- Stage: `src/server/routes/catalog.ts`
- Stage: `src/server/sources/source.test.ts`
- Stage: `src/server/sources/types.ts`
- Stage: `src/server/sources/worker-host.ts`

**Interfaces:**
- Consumes: passing verification evidence from Task 2 and the exact approved path list above.
- Produces: one intentional commit on the existing execution branch `codex/docker-build-action`, an upstream branch on `origin`, and a draft pull request targeting `main`.

- [ ] **Step 1: Verify the publication branch**

Run:

```bash
test "$(git branch --show-current)" = codex/docker-build-action
```

Expected: the command exits 0. The controller created this branch from `main` before implementation so no task writes directly on `main`.

- [ ] **Step 2: Stage only approved files**

Run:

```bash
git add .github/workflows/docker-build.yml \
  src/renderer/utils/musicSdk/wy/index.js \
  src/renderer/utils/musicSdk/wy/albumSearch.js \
  src/server/api/openapi.test.ts \
  src/server/api/schemas/domain.ts \
  src/server/downloads/manager.ts \
  src/server/downloads/types.ts \
  src/server/tuneFlowSdk/index.ts \
  src/server/routes/catalog.test.ts \
  src/server/routes/catalog.ts \
  src/server/sources/source.test.ts \
  src/server/sources/types.ts \
  src/server/sources/worker-host.ts
git diff --cached --check
git status --short
```

Expected: `git diff --cached --check` exits 0. Only the 13 approved paths are staged; data, build output, images, unrelated documentation, and process documents remain unstaged or absent.

- [ ] **Step 3: Commit the approved changes**

Run:

```bash
git commit -m "feat: expand catalog API and verify Docker build"
```

Expected: Git creates one commit containing only the staged files.

- [ ] **Step 4: Push the branch**

Run:

```bash
git push -u origin codex/docker-build-action
```

Expected: `origin/codex/docker-build-action` is created and tracking is configured.

- [ ] **Step 5: Open the draft pull request**

Write a temporary PR body file containing real Markdown with: the catalog/search and download-contract additions; the Docker build/health CI; and the exact verification commands and results. Set `PR_BODY_FILE` to that file's absolute path, then run:

```bash
gh pr create --draft --base main --head codex/docker-build-action \
  --title "Expand catalog API and verify Docker builds" \
  --body-file "$PR_BODY_FILE"
```

Expected: GitHub CLI prints the URL of a new draft pull request targeting `main`.

- [ ] **Step 6: Confirm publication state**

Run:

```bash
git status -sb
gh pr view --json url,isDraft,baseRefName,headRefName,title
```

Expected: the branch tracks `origin/codex/docker-build-action`; the PR is a draft from `codex/docker-build-action` into `main`; excluded local files remain untracked and uncommitted.
