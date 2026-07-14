import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "服务条款 | Tutti",
  description: "Tutti 文档导入与草稿预览服务条款。"
};

export default function TermsPage() {
  return (
    <main className="policy-page">
      <article className="policy-card">
        <p className="policy-eyebrow">TUTTI · TERMS</p>
        <h1>服务条款</h1>
        <p className="policy-updated">最后更新：2026 年 7 月 14 日</p>

        <p>
          使用 Tutti 即表示你同意本条款。Tutti 当前提供文档导入、格式转换、草稿预览与相关演示功能。
        </p>

        <h2>账号与授权</h2>
        <p>
          你应当仅连接自己有权访问的账号和文档。Google Docs 访问由你主动发起，并受 Google 授权页面上展示的权限范围约束。
        </p>

        <h2>内容责任</h2>
        <p>
          你保留对所导入内容的权利，并负责确保导入、编辑和使用这些内容符合法律及第三方权利要求。
          请勿上传违法、有害或侵犯他人权益的内容。
        </p>

        <h2>服务可用性</h2>
        <p>
          我们会尽合理努力维护服务，但演示功能可能更新、中断或发生格式转换差异。重要内容请自行保留原始副本，
          不应将本服务作为唯一存储位置。
        </p>

        <h2>责任限制</h2>
        <p>
          在适用法律允许的范围内，Tutti 不对因服务中断、第三方平台变更、用户操作或导入结果差异导致的间接损失承担责任。
        </p>

        <h2>条款变更</h2>
        <p>
          我们可能随着产品和法律要求更新本条款，并在本页面标注最新日期。继续使用更新后的服务即表示接受修订后的条款。
        </p>

        <h2>联系我们</h2>
        <p>
          如对本条款有疑问，请发送邮件至
          <a href="mailto:makuta0919@gmail.com"> makuta0919@gmail.com</a>。
        </p>

        <nav className="policy-links" aria-label="政策导航">
          <a href="/">返回首页</a>
          <a href="/privacy">查看隐私政策</a>
        </nav>
      </article>
    </main>
  );
}
