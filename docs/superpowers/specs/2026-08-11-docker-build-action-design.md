# Docker Build Action Design

## Objective

Publish the repository's current source-code changes and add a GitHub Actions check that proves the production Docker image can be built and started successfully.

## Scope

- Include all currently modified and untracked source-code files under `src/`.
- Add `.github/workflows/docker-build.yml`.
- Exclude runtime data under `data/`, generated output under `dist/`, and the unrelated `docs/flutter-ui-api-matrix.md` file.
- Do not publish a container image or change deployment infrastructure.

## Workflow Design

The workflow runs for pushes to `main`, pull requests targeting `main`, and manual dispatches. It uses Docker Buildx to build the repository's `Dockerfile` for Linux amd64 without pushing the image.

After a successful build, the workflow starts a container with an isolated temporary data volume without publishing port 3124 to the host, and polls Docker's internal health check until it reports `healthy`. If the container exits or does not become healthy within the bounded wait, the job prints container logs and fails. A final cleanup step removes the test container and volume even when an earlier step fails.

## Local Verification

Before publication:

1. Run the repository's unit and build-configuration tests.
2. Build the Docker image locally from the same `Dockerfile`.
3. Start the image and verify its health status or `/api/v1/health` response.
4. Inspect the staged diff to ensure only the approved source files and workflow are included.

## Publication

Create a dedicated branch from `main`, commit the approved source changes and workflow, push it to `origin`, and open a draft pull request targeting `main`. The locally stored design document is process documentation and is not part of the requested code publication unless separately approved.

## Success Criteria

- Local tests pass.
- The Docker image builds successfully.
- A container created from the image reaches the healthy state.
- The GitHub branch and draft pull request contain only the approved code and CI changes.
