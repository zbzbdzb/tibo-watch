import type { ChromePageDiagnostic } from '../shared/chromeDiagnostics';

export function collectionReason(reason: ChromePageDiagnostic['reason']): string {
  return {
    stable_timeline: '已读到稳定时间线', empty_timeline: '页面明确显示无动态',
    pinned_only: '目前仅识别到置顶帖，尚未确认后续时间线', unstable_timeline: '时间线内容持续变化，尚未稳定',
    page_loading: '尚未读到可验证的时间线', login_required: '页面要求登录', page_error: 'X 页面报错',
    navigation_changed: '标签页已跳转，未按目标页采集', read_failed: '页面读取失败',
    active_detail: '正在查看长文详情，等待切到后台后恢复采集', old_collector: '旧采集器，未提供细分诊断',
  }[reason];
}

export function sourceStatus(state: string, errorCode?: string | null) {
  let label = ({ online: '在线', syncing: '同步中', partial: '部分采集完成',
    stale: '数据已超时', needs_login: '需重新登录', disabled: '已停用', error: '采集异常' } as Record<string, string>)[state] ?? '异常';
  let description = '';
  if (errorCode === 'X_COMPANION_WAITING') {
    label = '等待扩展';
    description = '尚未收到 Chrome 扩展的采集结果，不代表 X 登录已失效。';
  } else if (errorCode === 'X_COMPANION_LEGACY_NEEDS_REFRESH' || errorCode === 'X_COMPANION_COLLECTOR_NEEDS_REFRESH') {
    label = '需重载扩展';
    description = '已收到扩展报告，但运行中的采集器仍为旧版。请在 Chrome 扩展页重新加载；磁盘文件更新不代表脚本已重载。';
  } else if (errorCode?.endsWith('_INCOMPLETE')) {
    label = '采集未完成';
    description = '连接仍有响应，但超过 10 分钟未完成同一轮的两页采集。请查看下方每页原因；这不代表登录过期或连接中断。';
  } else if (errorCode === 'X_COLLECTION_DETAILS_PENDING') {
    description = '连接正常，帖子和回复时间线已采集；部分长文正文仍待补全，不代表登录失效。';
  } else if (errorCode === 'X_COLLECTION_SYNCING_PREVIOUS_OK') {
    description = '连接正常，正在同步新一轮页面；上一轮成功结果仍在有效期内。';
  } else if (state === 'syncing') {
    description = '连接正常，正在等待帖子和回复页完成同一轮采集。已有动态保留。';
  } else if (state === 'stale') {
    description = errorCode?.endsWith('_TIMEOUT')
      ? '仍收到采集报告，但超过 10 分钟未完成两页采集；请检查 X 页面加载情况。'
      : '有页面超过有效期未更新；请检查 Chrome 是否运行及 X 页面是否正常。';
  } else if (state === 'needs_login') {
    description = 'X 页面明确要求登录，请在 Chrome 中恢复登录。';
  } else if (state === 'error') {
    description = '页面读取失败，不等同于登录过期；请检查 X 页面是否报错。';
  }
  if (errorCode?.includes('POSTS_LOADING')) description += ' 帖子页尚未加载完成。';
  if (errorCode?.includes('REPLIES_LOADING')) description += ' 回复页尚未加载完成。';
  const tone = state === 'online' ? '' : state === 'disabled' ? 'status-disabled'
    : state === 'syncing' || state === 'partial' || errorCode === 'X_COMPANION_WAITING' ? 'status-warning' : 'status-error';
  return { label, description, tone };
}
