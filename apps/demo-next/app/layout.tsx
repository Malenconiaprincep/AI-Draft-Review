import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tutti AI 草稿审阅 Demo",
  description: "Tutti AI Draft Review 最小交付集成演示。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <footer className="site-legal-footer">
          <span>© 2026 Tutti</span>
          <a href="/privacy">隐私政策</a>
          <a href="/terms">服务条款</a>
          <a href="mailto:makuta0919@gmail.com">联系我们</a>
        </footer>
      </body>
    </html>
  );
}
