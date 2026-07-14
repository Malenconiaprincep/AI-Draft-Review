# Content Import Connectors Specification

## Requirements

### Requirement: Connector isolation

The package SHALL expose provider-neutral contracts and SHALL NOT persist credentials, drafts, or assets.

### Requirement: Explicit authorization

Every provider request SHALL use an explicitly authorized user connection or caller-supplied access token. MCP OAuth state, PKCE, dynamic client registration and credential persistence SHALL remain a host responsibility.

YouMind requests SHALL use an explicitly supplied personal OpenAPI Key. The host SHALL NOT read or reuse the user's YouMind browser session Cookie.

### Requirement: YouMind personal library

The YouMind connector SHALL use the official OpenAPI to list authorized Boards and Files before importing the selected File. It SHALL support the current `listFiles` and `getFile` operations and MAY fall back to the documented legacy `listCrafts`, `listMaterials`, and `getCraft` operations.

### Requirement: Official Notion MCP

Interactive Notion user connections SHALL prefer the official hosted Notion MCP server. The host SHALL call `notion-fetch` for the selected page and the connector package SHALL deterministically normalize the returned content without an MCP agent planning loop.

### Requirement: Google Docs personal library

The Google Docs connector SHALL use an explicitly authorized Google user connection and Google Picker. The host SHALL request only per-file `drive.file` access, SHALL NOT enumerate the user's complete Drive library, and SHALL fetch only the document ID returned by the current Picker selection. The connector SHALL read title metadata with Drive `files.get`, SHALL prefer Drive `files.export` with `text/markdown` for the body, and MAY fall back to Google Docs `documents.get` when Markdown export is unavailable.

### Requirement: Deterministic import

Connectors SHALL fetch and transform provider data deterministically without an LLM or MCP agent planning loop.

### Requirement: Canonical normalization

Provider documents SHALL first be represented as a Canonical Document and then converted into `DraftDocJSON` using the shared `@tutti/draft-doc` contract.

### Requirement: Asset handoff

Remote images and files SHALL be returned as external asset records. Provider temporary URLs SHALL NOT be treated as permanent Tutti asset URLs.

### Requirement: Partial fidelity

Unsupported provider blocks SHALL be omitted or converted to readable fallback text and SHALL generate an import warning when content fidelity may be reduced.

### Requirement: Source revision

The import result SHALL include the provider document identifier and the best available provider revision or last-edited value so the host can detect repeated imports.
