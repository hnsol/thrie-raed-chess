## ワークフロー
- 設計・方針決定・レビューは自分が行う
- 実装は @agent-implementer または @agent-fast-implementer に委譲する
- 軽量タスク → fast-implementer、重要な実装 → implementer
- サブエージェントの出力が不十分なら指示を精緻化して再実行する

## 実装方針
- 新機能は web/（TypeScript）に実装する
- TUI版（thrie_raed_chess/）は凍結（バグ修正のみ）

## 作業記録
- 作業開始時に前回の記録を読む
- コミット時に記録を書く
- 明示的に指示された場合も書く
- 記録内容：やったこと、判断理由、未解決事項、次のアクション
- 1回の記録は10行以内を目安
- 記録先は .claude/CLAUDE.local.md を参照

