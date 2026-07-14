import type { DraftDocJSON } from "@tutti/draft-doc";

export type ConnectorProvider = "notion" | "feishu" | "youmind" | "googledocs";

export type ConnectorToken = {
  accessToken: string;
  refreshToken?: string;
  tokenType: "bearer";
  expiresAt?: string;
  refreshExpiresAt?: string;
  accountId?: string;
  accountName?: string;
  metadata?: Record<string, unknown>;
};

export type ExternalDocumentRef = {
  provider: ConnectorProvider;
  id: string;
  kind: string;
  url?: string;
};

export type ConnectorDocumentListItem = ExternalDocumentRef & {
  title: string;
  lastEditedAt?: string;
};

export type ConnectorDocumentPage = {
  items: ConnectorDocumentListItem[];
  nextCursor?: string;
};

export type CanonicalMark = {
  type: "bold" | "italic" | "strike" | "code" | "link";
  attrs?: Record<string, unknown>;
};

export type CanonicalNode = {
  type:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "codeBlock"
    | "callout"
    | "toggle"
    | "toggleSummary"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "table"
    | "tableRow"
    | "tableCell"
    | "tableHeader"
    | "columns"
    | "column"
    | "image"
    | "video"
    | "audio"
    | "horizontalRule"
    | "hardBreak"
    | "text"
    | "unsupported";
  text?: string;
  marks?: CanonicalMark[];
  attrs?: Record<string, unknown>;
  content?: CanonicalNode[];
};

export type ExternalAsset = {
  id: string;
  provider: ConnectorProvider;
  kind: "image" | "file" | "video" | "audio";
  sourceUrl?: string;
  providerToken?: string;
  filename?: string;
  mimeType?: string;
  expiresAt?: string;
};

export type ImportWarning = {
  code:
    | "unsupported_block"
    | "unsupported_markdown"
    | "missing_asset"
    | "partial_document"
    | "format_downgraded";
  message: string;
  sourceId?: string;
};

export type CanonicalDocument = {
  ref: ExternalDocumentRef;
  title: string;
  revision?: string;
  lastEditedAt?: string;
  content: CanonicalNode[];
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

export type ContentImportResult = {
  source: ExternalDocumentRef;
  sourceRevision?: string;
  sourceLastEditedAt?: string;
  title: string;
  doc: DraftDocJSON;
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

export type ListDocumentsInput = {
  query?: string;
  cursor?: string;
  pageSize?: number;
};

export interface ContentConnector {
  readonly provider: ConnectorProvider;
  getAuthorizationUrl(state: string): string;
  exchangeAuthorization(code: string): Promise<ConnectorToken>;
  refreshAuthorization(token: ConnectorToken): Promise<ConnectorToken>;
  resolveDocument(urlOrId: string): ExternalDocumentRef;
  listDocuments?(
    token: ConnectorToken,
    input?: ListDocumentsInput
  ): Promise<ConnectorDocumentPage>;
  fetchDocument(token: ConnectorToken, ref: ExternalDocumentRef): Promise<CanonicalDocument>;
}

export type FetchLike = typeof fetch;
