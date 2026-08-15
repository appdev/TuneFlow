# README Information Architecture Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the root README so product information appears before usage instructions and every major section is reachable from a table of contents.

**Architecture:** Keep the README as one self-contained document. Reorder existing sections into a product-first reader journey, group deployment and source-build material under a new “如何使用” section, and use explicit ASCII HTML anchors so navigation does not depend on renderer-specific Chinese heading slugs.

**Tech Stack:** GitHub-flavored Markdown, HTML anchors, Git diff checks

## Global Constraints

- Preserve the complete existing project agreement in `README.md`.
- Preserve all existing deployment commands, upgrade steps, persistence guidance, security warnings, contribution guidance, and product capability statements.
- Do not add dependencies or change runtime code.
- Keep the detailed `docs/server-web.md` link in the usage section.

---

### Task 1: Reorganize README and add navigation

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-08-14-readme-information-architecture-design.md`

**Interfaces:**
- Consumes: Existing README prose, commands, image paths, and agreement text.
- Produces: A product-first README whose table-of-contents links target explicit HTML anchors.

- [x] **Step 1: Add the table of contents and explicit anchors**

Immediately after the centered project tagline, add this navigation block:

```markdown
<a id="目录"></a>

## 目录

- [产品介绍](#product-overview)
- [功能边界](#feature-boundaries)
- [用户界面](#user-interface)
- [如何使用](#usage)
  - [Docker 部署（推荐）](#docker-deployment)
  - [源码构建与启动](#source-build)
  - [数据存储目录](#data-storage)
- [贡献代码](#contributing)
- [项目协议](#project-agreement)
```

Use the following explicit anchor IDs immediately before their corresponding headings:

```text
product-overview
feature-boundaries
user-interface
usage
docker-deployment
source-build
data-storage
contributing
project-agreement
```

- [x] **Step 2: Reorder the existing sections into the approved reader journey**

Arrange the README body in exactly this order:

```text
Project logo, title, and tagline
目录
产品介绍
功能边界
用户界面
如何使用
  Docker 部署（推荐）
    使用 docker run
    使用 Docker Compose
  源码构建与启动
  数据存储目录
  Server + Web 详细文档 link
贡献代码
项目协议
```

Rename `说明` to `产品介绍`. Add `如何使用` as a level-two heading. Under it, make `Docker 部署（推荐）`, `源码构建与启动`, and `数据存储目录` level-three headings; make `使用 docker run` and `使用 Docker Compose` level-four headings. Move the existing “源码使用方法” link beneath the data storage content as a short detailed-documentation paragraph, then remove the redundant standalone heading.

Do not rewrite the substantive content while moving it. In particular, retain both Docker workflows, update commands, network exposure warning, storage migration guidance, contribution requirements, screenshot, and every numbered project-agreement clause.

- [x] **Step 3: Verify navigation and preserved structure**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs')
const text = fs.readFileSync('README.md', 'utf8')
const ids = new Set([...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]))
const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map(match => match[1])
const missing = links.filter(link => !ids.has(link))
if (missing.length > 0) throw new Error(`Missing README anchors: ${missing.join(', ')}`)
console.log(`Verified ${links.length} README navigation links`)
NODE
```

Expected: exit code `0` and `Verified 9 README navigation links`.

Run:

```bash
rg -n '^#{2,4} ' README.md
git diff --check -- README.md
git diff -- README.md
```

Expected: headings appear in the planned order, `git diff --check` exits `0`, and manual diff inspection shows only section movement, heading-level changes, anchors, the directory, and the merged detailed-documentation paragraph. Confirm the agreement still contains sections 一 through 九 and clauses `1.1` through `9.1`.

- [x] **Step 4: Record completion without committing**

Leave `README.md`, this plan, and its design spec uncommitted unless the user separately authorizes a commit. Report the modified files and the exact verification results.
