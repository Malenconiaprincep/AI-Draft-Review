type NotionBrowserPersistenceEnvironment = {
  NODE_ENV?: string;
  NOTION_BROWSER_SESSION_PERSISTENCE?: string;
  NOTION_DEV_LOCAL_STORAGE?: string;
};

export function isNotionBrowserSessionPersistenceAvailable(
  environment: NotionBrowserPersistenceEnvironment = process.env
) {
  const productionOptIn = environment.NOTION_BROWSER_SESSION_PERSISTENCE;
  if (productionOptIn === "true" || productionOptIn === "1") return true;
  if (productionOptIn === "false" || productionOptIn === "0") return false;
  return environment.NODE_ENV !== "production"
    && (environment.NOTION_DEV_LOCAL_STORAGE === "true" || environment.NOTION_DEV_LOCAL_STORAGE === "1");
}
