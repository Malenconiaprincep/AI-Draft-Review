import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import type {
  ConnectorToken,
  ContentConnector,
  ContentImportResult,
  ExternalDocumentRef
} from "./types.ts";

export async function importConnectedDocument(input: {
  connector: ContentConnector;
  token: ConnectorToken;
  source: string | ExternalDocumentRef;
}): Promise<ContentImportResult> {
  const ref =
    typeof input.source === "string"
      ? input.connector.resolveDocument(input.source)
      : input.source;
  const document = await input.connector.fetchDocument(input.token, ref);
  return canonicalDocumentToDraftDoc(document);
}
