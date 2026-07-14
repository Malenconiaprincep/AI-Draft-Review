import type { Metadata } from "next";
import { ContentImportDemo } from "./content-import-demo";

export const metadata: Metadata = {
  title: "Tutti 内容导入 Demo",
  description: "测试 Notion 和飞书连接器内容预览。"
};

export default function ImportDemoPage() {
  return <ContentImportDemo />;
}
