# 通用重置语义分类器设计

## 目标

修复将明确的未来重置公告降级为“相关”的问题，同时移除 `performative reset` 这类针对单句设计的伪产品关键词。分类器必须从多类可组合证据判断，而不是依赖固定完整句式。

## 证据模型

- 重置动作：`reset` 及其词形，以及在明确额度上下文中的 `refill`、`replenish`、`restore`、`top up`。
- 产品/额度对象：Codex、ChatGPT、usage/rate limits、quota、allowance、credits、capacity。
- 用户范围：everyone、all users、paid users、subscribers、customers、teams、organizations、all plans。
- 连续性：another、again、one more、continue，允许后续公告省略产品名。
- 时态：完成信号、未来承诺、明确未来时间、疑问可能性分别提取。
- 抑制信号：明确否定、撤回，以及 password/server/database 等非额度重置对象。

## 判级

1. 明确否定或撤回不会升级，保留为“相关”。
2. 非额度对象且没有产品或额度证据，不得判为预告或确认。
3. 重置动作 +（产品/额度、用户范围或连续性）+ 未来承诺/时间/疑问，判为“预告”。
4. 重置动作 +（产品/额度或用户范围）+ 完成时态，判为“确认”。未来信号优先于可能被误读成完成的祈使表达。
5. 只有重置或额度上下文但缺少时态时，判为“相关”；其余为“无关”。

## 可解释性

`matchedTerms` 只展示原文中实际参与判定的动作、对象、范围和时间短语。`performative reset` 不再作为一个关键词；对应动态应展示 `reset` 和 `Monday`。判定理由根据证据类别生成，例如“检测到重置动作、用户范围及明确未来时间（next hour）”。

## 历史数据

分类器最终版本升级到 `rules-v4`。应用启动时沿用现有重分类流程，为旧动态保存新证据；从“相关”升级到“预告”时生成一次升级事件，数据库唯一约束阻止重复提醒。

## 验收

- 截图中的 `reset everyone + next hour` 判为预告。
- Monday 动态仍判为预告，但匹配词不含 `performative reset`。
- 多种相对时间、承诺、完成、疑问、否定和非额度重置表达均有表驱动测试。
- 既有分类、通知去重、邮件和 Electron 端到端测试全部通过。
