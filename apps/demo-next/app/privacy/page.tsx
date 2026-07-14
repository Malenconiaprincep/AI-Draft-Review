import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隐私政策 | Tutti",
  description: "Tutti Google Docs 导入功能的隐私政策。"
};

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <article className="policy-card">
        <p className="policy-eyebrow">TUTTI · PRIVACY</p>
        <h1>隐私政策</h1>
        <p className="policy-updated">最后更新：2026 年 7 月 14 日</p>

        <p>
          Tutti 提供文档导入与草稿预览功能。本政策说明 Google Docs 导入过程中会访问哪些数据，
          以及这些数据如何被使用和保护。
        </p>

        <h2>我们访问的数据</h2>
        <p>
          当你主动点击“连接 Google”并通过 Google Picker 选择文档时，Tutti 仅请求访问你明确选择的
          Google Docs 文件。我们使用 <code>drive.file</code> 权限，不会浏览或读取你未选择的其他云端硬盘文件。
        </p>

        <h2>数据用途</h2>
        <p>
          所选文档的标题与正文仅用于转换为 Tutti 编辑器可展示的内容。Google 用户数据不会被出售、用于广告，
          也不会被用于训练通用人工智能模型。
        </p>

        <h2>令牌与保存期限</h2>
        <p>
          Google 返回的访问令牌仅保存在服务器短期内存会话中，并受令牌自身有效期限制；Tutti 不保存 Google
          密码，也不申请长期刷新令牌。导入内容是否继续保留，由你在后续编辑或保存操作中决定。
        </p>

        <h2>共享与安全</h2>
        <p>
          我们只会向提供托管、网络与安全能力的必要服务商传输运行服务所需的数据，并采取合理的访问控制和传输加密措施。
          除法律要求外，不会向其他第三方披露你的 Google 用户数据。
        </p>

        <h2>你的选择</h2>
        <p>
          你可以取消 Picker、断开连接，或在 Google 账号的第三方应用授权页面撤销 Tutti 的访问权限。
          撤销后需要重新授权才能再次导入文档。
        </p>

        <h2>联系我们</h2>
        <p>
          如需查询、更正或删除与本服务相关的数据，请发送邮件至
          <a href="mailto:makuta0919@gmail.com"> makuta0919@gmail.com</a>。
        </p>

        <nav className="policy-links" aria-label="政策导航">
          <a href="/">返回首页</a>
          <a href="/terms">查看服务条款</a>
        </nav>
      </article>
    </main>
  );
}
