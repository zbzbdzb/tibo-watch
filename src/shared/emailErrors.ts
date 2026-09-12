/** Error codes are persisted; explain both current codes and older timeout rows. */
export function emailErrorLabel(code: string | null | undefined): string {
  if (!code) return '请检查邮件配置';
  const labels: Record<string, string> = {
    EMAIL_PROXY_TIMEOUT: '代理连接或配置解析超时，请检查系统代理是否可用',
    EMAIL_PROXY_RESOLUTION_FAILED: '无法读取系统代理配置，请检查代理或 PAC 设置',
    EMAIL_PROXY_UNAVAILABLE: '无法通过系统代理连接邮件服务器，请检查代理节点和规则',
    EMAIL_PROXY_AUTH_REQUIRED: '系统代理要求额外身份验证，当前不支持该代理认证方式',
    EMAIL_PROXY_UNSUPPORTED: '当前系统代理类型不受支持，请使用 HTTP、HTTPS 或免认证 SOCKS5 代理',
    EMAIL_SERVER_INVALID: 'SMTP 服务器地址或端口无效，请检查邮件配置',
    EMAIL_CONNECTION_TIMEOUT: '连接 SMTP 服务器超时，请检查网络、代理规则和端口',
    EMAIL_GREETING_TIMEOUT: 'SMTP 服务器响应超时，请检查端口与 SSL/TLS 设置',
    EMAIL_SEND_TIMEOUT: '邮件发送响应超时，结果可能不确定，请先检查收件箱',
    ETIMEDOUT: '邮件连接或发送超时（旧记录未区分阶段），请检查网络和代理',
    EAUTH: 'SMTP 账号验证失败，请检查用户名和应用密码',
    ECONNECTION: 'SMTP 连接中断，请检查网络与服务器状态',
    ECONNREFUSED: 'SMTP 服务器拒绝连接，请检查主机、端口和防火墙',
    ESOCKET: 'SMTP 连接或 TLS 握手失败，请检查证书、网络和端口设置',
    EDNS: '无法解析 SMTP 服务器地址，请检查主机名和 DNS',
    EENVELOPE: 'SMTP 服务器拒绝发件人或收件人，请检查邮箱地址',
    EMAIL_NOT_CONFIGURED: '邮件配置未完成，请检查开关、应用密码与收件人',
    SMTP_PARTIAL_ACCEPTANCE: '部分收件人未被服务器接受，请查看送达记录',
    SMTP_RECIPIENT_REJECTED: 'SMTP 服务器未接受该收件人',
    SMTP_SEND_FAILED: '邮件发送失败，请检查配置和服务器状态',
  };
  return labels[code] ? `${labels[code]}（${code}）` : code;
}
