import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tutti AI 草稿审阅 Demo",
  description: "Tutti AI Draft Review 最小交付集成演示。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
