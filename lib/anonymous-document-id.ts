const ANONYMOUS_DOCUMENT_PREFIX = "local-"

export function anonymousDocumentIdFromUuid(uuid: string): string {
  return `${ANONYMOUS_DOCUMENT_PREFIX}${uuid}`
}

export function isAnonymousDocumentId(id: string): boolean {
  return id.startsWith(ANONYMOUS_DOCUMENT_PREFIX)
}
