type BrowserSessionPersistenceEnvironment = {
  NODE_ENV?: string;
  BROWSER_SESSION_PERSISTENCE?: string;
  NOTION_BROWSER_SESSION_PERSISTENCE?: string;
  NOTION_DEV_LOCAL_STORAGE?: string;
};

export function isBrowserSessionPersistenceAvailable(
  environment: BrowserSessionPersistenceEnvironment = process.env
) {
  const optIn = environment.BROWSER_SESSION_PERSISTENCE
    ?? environment.NOTION_BROWSER_SESSION_PERSISTENCE;
  if (optIn === "true" || optIn === "1") return true;
  if (optIn === "false" || optIn === "0") return false;
  return environment.NODE_ENV !== "production"
    && (environment.NOTION_DEV_LOCAL_STORAGE === "true" || environment.NOTION_DEV_LOCAL_STORAGE === "1");
}
