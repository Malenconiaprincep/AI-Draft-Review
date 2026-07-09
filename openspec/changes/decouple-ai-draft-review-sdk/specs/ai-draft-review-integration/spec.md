# AI Draft Review Integration Spec

## ADDED Requirements

### Requirement: Minimum Delivery Scope

The system SHALL limit the first delivery to six reusable packages and one demo app.

#### Scenario: Deliver P0 packages

- WHEN the first delivery is completed
- THEN it SHALL include `@tutti/draft-doc`
- AND it SHALL include `@tutti/editor-highlight-sdk`
- AND it SHALL include `@tutti/ai-assistant-service`
- AND it SHALL include `@tutti/ai-assistant-react`
- AND it SHALL include `@tutti/brand-review-react`
- AND it SHALL include `@tutti/creator-feedback-react`
- AND it SHALL include `apps/demo-next`

#### Scenario: Exclude later adapters

- WHEN P0 scope is implemented
- THEN it SHALL NOT include Google Docs or Notion import adapters
- AND it SHALL NOT include Typefully-like publish adapters
- AND it SHALL NOT include a full creator editor persistence system
- AND it SHALL NOT include a full brand review backend, permission system or workflow state machine

### Requirement: Next.js Integration Project

The system SHALL provide a Next.js project that acts as a demo shell and integration reference for AI Draft Review capabilities.

#### Scenario: Run demo with fixtures

- WHEN a developer starts the Next.js app
- THEN the app SHALL render a draft review demo page using local fixture data
- AND the demo SHALL not require access to the production database
- AND the demo SHALL show the editor / viewer area and AI assistant panel together
- AND the demo MAY use local React state for demo-only workflow state

#### Scenario: Export reusable modules

- WHEN a host application wants to integrate the capability
- THEN the project SHALL expose reusable packages for DraftDocJSON, editor highlighting, AI assistant service, AI assistant React UI, brand review React UI and creator feedback React UI
- AND the host SHALL not need to adopt the demo shell routing or demo workflow state

### Requirement: DraftDocJSON Shared Package

The system SHALL provide a shared DraftDocJSON contract package.

#### Scenario: Install shared contract

- WHEN an external project integrates draft review capabilities
- THEN it SHALL be able to depend on a private package such as `@tutti/draft-doc`
- AND that package SHALL provide the Tiptap schema, fixtures, types and serialization helpers

#### Scenario: Avoid duplicated schema files

- GIVEN multiple repos need to parse or render DraftDocJSON
- WHEN they consume the shared package
- THEN they SHALL use the same schema implementation instead of manually maintaining byte-identical `schema.ts` copies

### Requirement: Host Boundary

The system SHALL keep host-owned workflow responsibilities outside the SDK, service and component.

#### Scenario: Handle AI inline suggestion

- WHEN a user applies or rejects an AI inline suggestion
- THEN the component SHALL call a host-provided callback
- AND the host SHALL decide whether to mutate DraftDocJSON, create records or only update local UI state
- AND the component SHALL not write directly to `review.tbl_draft_comment`

#### Scenario: Submit review decision

- WHEN a brand reviewer decides to approve, request changes or reject
- THEN the host SHALL use its existing review event entrypoint
- AND this project SHALL not directly update `post_state.status`

#### Scenario: Production data persistence

- WHEN the capability is integrated into a production host
- THEN draft data, comments, review notes, user permissions and review status SHALL be fetched and persisted by the host
- AND demo-only React state SHALL not be treated as production persistence

### Requirement: Draft Document Read Boundary

The system SHALL treat `doc_json` as read-only input.

#### Scenario: Render highlights

- WHEN open comments or AI inline suggestions are displayed
- THEN highlights SHALL be rendered as ProseMirror decorations
- AND the system SHALL not write highlight marks or metadata into `doc_json`

#### Scenario: AI assistant analyzes draft

- WHEN the AI assistant service analyzes a draft
- THEN it SHALL read `doc_json` and `doc_version`
- AND it SHALL return `analyzedDocVersion`
- AND it SHALL not mutate the draft document

### Requirement: Tiptap Schema Compatibility

The editor highlight SDK SHALL be compatible with the current Tiptap / ProseMirror document contract.

#### Scenario: Load supported doc

- GIVEN a `doc_json` root node with `{ "type": "doc" }`
- AND the supported extension set from the handoff document
- WHEN the SDK renders a viewer or editor decoration layer
- THEN ProseMirror absolute positions SHALL map consistently to comment anchors

#### Scenario: Unsupported schema

- WHEN a document cannot be parsed by the supported schema
- THEN the SDK or service SHALL fail with an explainable validation error
- AND the UI SHALL not silently render incorrect anchors

#### Scenario: Optional block identity

- GIVEN the host document schema does not yet include stable `blockId`
- WHEN the first version runs
- THEN the system SHALL still work through `quotedText` and optional preferred positions
- AND stable `blockId` SHALL be treated as a versioned improvement to the shared DraftDocJSON package

### Requirement: Editor Highlight SDK

The system SHALL provide an editor highlight SDK for AI suggestions and brand comments.

#### Scenario: Render AI and brand highlights

- GIVEN a list of AI suggestions and brand comments with anchors
- WHEN the SDK builds decorations
- THEN it SHALL render distinguishable highlight states for each source
- AND it SHALL support open, resolved, stale and orphaned states

#### Scenario: Select highlight from panel

- WHEN the user selects a suggestion in the AI assistant panel
- THEN the host SHALL be able to call SDK selection / scroll APIs
- AND the editor or viewer SHALL move focus to the corresponding highlight when locatable

#### Scenario: Editable editor behavior

- GIVEN the host uses the SDK inside an editable Tiptap editor
- WHEN the user clicks highlighted text
- THEN the text SHALL remain editable and caret placement SHALL work normally
- AND only explicit badge / panel interactions SHALL trigger selection callbacks

### Requirement: Anchor Recovery

The system SHALL recover anchors using both ProseMirror positions and quoted text.

#### Scenario: Position still valid

- GIVEN `anchor_from` and `anchor_to` still point to the quoted text
- WHEN the SDK renders the highlight
- THEN it SHALL use the absolute position anchor

#### Scenario: Position stale but text exists

- GIVEN the absolute position no longer matches
- AND `quoted_text` still exists elsewhere in the document
- WHEN the SDK locates the anchor
- THEN it SHALL use `quoted_text` fallback
- AND it SHALL mark the anchor as recovered if needed

#### Scenario: Anchor orphaned

- GIVEN neither position nor quoted text can be located
- WHEN the UI renders the comment
- THEN it SHALL show an orphaned comment state
- AND it SHALL display the quoted text snapshot as fallback context

#### Scenario: AI suggestion has quoted text only

- GIVEN an AI inline suggestion contains `quotedText` but no ProseMirror position
- WHEN the host renders highlights
- THEN the editor highlight SDK SHALL attempt to locate the quoted text in the current document
- AND it SHALL mark the suggestion as locatable, ambiguous or orphaned

### Requirement: Stateless AI Assistant Service

The AI assistant service SHALL be stateless and operate only on explicit request JSON.

#### Scenario: Analyze draft

- GIVEN a request containing draft, optional campaign brief, dynamic campaign context, review history and open comments
- WHEN `reviewDraft` is called
- THEN the service SHALL validate the request
- AND build a prompt from the provided data
- AND return a structured review proposal
- AND not read from or write to production databases

#### Scenario: Invalid request

- WHEN required fields are missing or malformed
- THEN the service SHALL return a validation error
- AND the component SHALL show an error state instead of rendering partial incorrect output

### Requirement: LLM Provider Configuration

The AI assistant service SHALL support DeepSeek as the preferred real provider and allow provider replacement through server-side configuration.

#### Scenario: Use DeepSeek provider

- GIVEN a DeepSeek API key and model are configured on the server
- WHEN `reviewDraft` is called
- THEN the service SHALL use the DeepSeek model adapter by default

#### Scenario: Use Minimax compatibility provider

- GIVEN Minimax credentials are configured and DeepSeek credentials are absent
- WHEN `reviewDraft` is called
- THEN the service SHALL be able to use the Minimax model adapter

#### Scenario: Missing provider configuration

- GIVEN no real provider configuration exists
- WHEN `reviewDraft` is called
- THEN the service SHALL return an explainable configuration error
- AND it SHALL NOT fall back to synthetic model output

#### Scenario: Integrator provides external model

- WHEN an integrator wants to use a different model provider
- THEN the service SHALL allow server-side injection of provider, model, API key, base URL or a custom `ModelAdapter`
- AND browser components SHALL not directly receive or forward raw API keys

### Requirement: Prompt And Proposal Contract

The AI assistant service SHALL separate prompt construction from structured proposal output.

#### Scenario: Build prompt

- WHEN the service builds a prompt
- THEN it SHALL include the draft text, optional campaign brief, dynamic campaign context, historical review notes, open comments, high-frequency rejection rules and output schema
- AND it SHALL instruct the model not to invent facts absent from the campaign context or brief
- AND it SHALL treat dynamic campaign context as the source of truth when structured brief is absent or less specific

#### Scenario: Return proposal

- WHEN the model returns a valid response
- THEN the service SHALL return `verdict`, `summary`, `inlineSuggestions` and `analyzedDocVersion`
- AND every inline suggestion SHALL include `quotedText`, `body`, `severity` and `category`
- AND inline suggestions SHALL NOT be required to include ProseMirror positions

#### Scenario: Avoid duplicate comments

- GIVEN an issue is already present in `openComments`
- WHEN the AI assistant generates suggestions
- THEN it SHOULD avoid creating a duplicate inline suggestion for the same quoted text and issue

### Requirement: AI Assistant Component

The system SHALL provide an embeddable React AI assistant component.

#### Scenario: Run review

- WHEN the user clicks the review action
- THEN the component SHALL call `onRunReview`
- AND show a reviewing state until a proposal or error is returned

#### Scenario: Show stale result

- GIVEN a proposal was generated for `doc_version = 7`
- AND the current input has `doc_version = 8`
- WHEN the component renders
- THEN it SHALL show the proposal as stale
- AND it SHALL require rerun before confirmed actions are encouraged

#### Scenario: Apply or reject inline suggestion

- GIVEN an inline suggestion has `action = replace`, `insert_after` or `delete`
- WHEN the user applies the suggestion
- THEN the component SHALL call a host-provided apply callback with the structured suggestion payload
- AND the host or demo adapter SHALL decide whether to mutate `DraftDocJSON`
- WHEN the user rejects the suggestion
- THEN the component SHALL call a host-provided reject callback
- AND remove or mark the suggestion as no longer pending without changing `DraftDocJSON`

#### Scenario: Bulk review actions

- GIVEN multiple inline suggestions are pending
- WHEN the user chooses apply all or reject all
- THEN the component SHALL call host-provided bulk callbacks
- AND SHALL keep persistence and versioning outside the component

#### Scenario: Display verdict without owning decision

- WHEN the component displays an AI verdict
- THEN the verdict SHALL be treated as advisory
- AND final approve, request changes or reject actions SHALL remain host-owned

### Requirement: Creator Feedback Component

The system SHALL provide an embeddable React creator feedback component for post-submit brand comments.

#### Scenario: Show brand feedback

- GIVEN a list of `DraftCommentThread` items from the host
- WHEN the creator feedback component renders
- THEN it SHALL show open and resolved feedback items
- AND it SHALL keep stable `B{n}` numbering based on the original comment order
- AND it SHALL not directly persist comment status changes

#### Scenario: Filter feedback

- GIVEN the creator has mixed open and resolved feedback
- WHEN the creator chooses all, pending or handled filters
- THEN the component SHALL filter the visible feedback list
- AND the counts SHALL remain based on the full input list

#### Scenario: Apply, reject or reopen feedback

- WHEN the creator applies feedback
- THEN the component SHALL call a host-provided apply callback with the structured comment payload
- WHEN the creator rejects feedback
- THEN the component SHALL call a host-provided reject callback
- WHEN the creator reopens handled feedback
- THEN the component SHALL call a host-provided reopen callback
- AND persistence SHALL remain host-owned

#### Scenario: Resubmit after feedback

- GIVEN all brand feedback items are resolved
- WHEN the creator chooses to resubmit
- THEN the component SHALL call a host-provided resubmit callback
- AND the component SHALL not directly update `post_state.status`

### Requirement: Brand Review Component

The system SHALL provide an embeddable React brand review component for submitted drafts.

#### Scenario: Add selection feedback before sending

- GIVEN a submitted draft and a selected text range from the viewer
- WHEN the brand review component renders
- THEN it SHALL show review context, selected text and feedback drafts
- AND it SHALL allow the brand reviewer to choose comment or replace action
- AND it SHALL call a host-provided create callback with `quotedText`, `action`, optional `suggestedText` and feedback body
- AND it SHALL not directly persist comments

#### Scenario: Send feedback to creator

- GIVEN one or more feedback drafts exist
- WHEN the brand reviewer sends feedback
- THEN the component SHALL call a host-provided send callback with the structured `DraftCommentThread` payloads
- AND the component SHALL not directly update `post_state.status`

#### Scenario: Approve draft

- GIVEN no unsent feedback drafts exist
- WHEN the brand reviewer approves the draft
- THEN the component SHALL call a host-provided approve callback
- AND the final workflow transition SHALL remain host-owned

### Requirement: Demo Completeness

The demo SHALL demonstrate the complete integration path without pretending to own production workflow.

#### Scenario: End-to-end demo path

- WHEN the demo page is opened
- THEN a user SHALL be able to run AI review
- AND see a structured proposal
- AND see inline highlights in the draft viewer
- AND select panel items to locate highlights
- AND apply or reject AI suggestions through mock host callbacks
- AND submit the draft into a demo-only brand review stage
- AND use the brand review component to add feedback or approve
- AND send feedback to the creator through component callbacks
- AND handle feedback through the creator feedback component
- AND resubmit after all feedback is handled

#### Scenario: Demo state boundary clarity

- WHEN the demo uses local React state for workflow transitions
- THEN the UI or docs SHALL identify those transitions as host integration examples
- AND the docs SHALL state that production persistence belongs to the host system

### Requirement: Documentation

The project SHALL document integration contracts and invariants.

#### Scenario: External developer reads docs

- WHEN an external developer reads the project documentation
- THEN they SHALL be able to identify required input fields, service response fields, component props, host callbacks and editor SDK APIs
- AND they SHALL understand that AI assistant and highlight SDK never mutate `doc_json`
- AND they SHALL understand that review status changes remain host-owned
