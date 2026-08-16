---
name: OpenAPI integer compatibility
description: A code-generation compatibility constraint for numeric OpenAPI fields in this workspace.
---

When adding numeric OpenAPI fields, prefer `type: number` with `minimum` and `maximum` constraints unless the local Orval/Zod setup has explicitly been upgraded to support integer schemas.

**Why:** The current generated server schemas target a Zod 3 runtime, while the generator can emit `zod.int()` for OpenAPI `integer`; that makes codegen's chained typecheck fail before the app can build.

**How to apply:** After changing `lib/api-spec/openapi.yaml`, run the API codegen command and the workspace typecheck before relying on the generated request/response schemas.