// thrie_raed_chess/coach.py の忠実移植。
//
// 手ごとの損失(センチポーン差)に応じ、感嘆句×本文プールを合成して
// 褒め/励ましコメントを作る。テンプレ合成＋履歴回避で多彩な表現にする。
//
// 日本語フレーズ表(_EXCLAIM/_BODY/_PHASE_BODY/_FACT_GOOD/_FACT_BAD/_STREAK_BODY)は
// Python 版から一言一句変えずに逐語コピーしている。
//
// 乱数は Python の random.Random に相当する注入可能な Rng に置き換える。

import { Chess } from "chess.js";
import { GREEN_MAX } from "../config";
import { defaultRng, type Rng } from "./rng";

export type Tier =
  | "BRILLIANT"
  | "EXCELLENT"
  | "GOOD"
  | "SOSO"
  | "ROUGH"
  | "BLUNDER";

export type GamePhase = "opening" | "middlegame" | "endgame";

// ポーン以外の駒価値(キング除く)。終盤判定に使う。
// chess.js の piece type は小文字1文字。
const _PIECE_VALUE: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };

// 損失値から段階を判定する。
export function tierOf(loss: number): Tier {
  if (loss <= 0) return "BRILLIANT";
  if (loss <= GREEN_MAX) return "EXCELLENT"; // 1-30
  if (loss <= 80) return "GOOD";
  if (loss <= 150) return "SOSO"; // 81-150 (YELLOW_MAX)
  if (loss <= 300) return "ROUGH";
  return "BLUNDER";
}

// 局面を序盤/中盤/終盤に分ける。
export function gamePhase(board: Chess): GamePhase {
  const grid = board.board();
  let whiteQ = false;
  let blackQ = false;
  let total = 0;
  for (const row of grid) {
    for (const sq of row) {
      if (sq === null) continue;
      if (sq.type === "q") {
        if (sq.color === "w") whiteQ = true;
        else blackQ = true;
      }
      const val = _PIECE_VALUE[sq.type];
      if (val !== undefined) total += val;
    }
  }
  if (board.moveNumber() <= 10 && whiteQ && blackQ) return "opening";
  if (total <= 13) return "endgame";
  return "middlegame";
}

// 段階ごとの感嘆句
const _EXCLAIM: Record<Tier, string[]> = {
  BRILLIANT: ["お見事！", "完璧！", "最高！", "神の一手！", "文句なし！",
    "ブラボー！", "圧巻！", "素晴らしい！", "見事すぎ！", "パーフェクト！"],
  EXCELLENT: ["ナイス！", "いいね！", "上手い！", "冴えてる！", "good！",
    "やるね！", "鋭い！", "その調子！", "見事！", "さすが！"],
  GOOD: ["悪くない！", "いい判断！", "OK！", "堅実！", "まずまず良い！",
    "しっかり！", "手堅い！", "いい感じ！", "順調！", "落ち着いてる！"],
  SOSO: ["まずまず！", "ぼちぼち！", "悪くはない！", "ここから！", "耐えてる！",
    "粘ろう！", "焦らず！", "大丈夫！", "五分五分！", "続けよう！"],
  ROUGH: ["ドンマイ！", "気にしない！", "切り替え！", "まだいける！", "落ち着こう！",
    "次だ次！", "顔上げて！", "取り返そう！", "諦めない！", "巻き返そう！"],
  BLUNDER: ["ドンマイ！", "大丈夫、次！", "誰でもある！", "気を取り直そう！", "元気出して！",
    "ここからだ！", "まだ終わらない！", "顔を上げて！", "深呼吸！", "立て直そう！"],
};

// 段階ごとの本文(汎用)
const _BODY: Record<Tier, string[]> = {
  BRILLIANT: ["理想の一手だ！", "これぞ最善！", "非の打ち所なし！", "完璧な選択！",
    "読み切ってる！", "一切の緩みなし！", "会心の手！", "見事な決断！",
    "エンジンも唸る！", "文句なしの手！", "光る一手！", "冴え渡ってる！"],
  EXCELLENT: ["ほぼ最善だ！", "とても良い手！", "筋がいい！", "好判断だね！",
    "着実に良い！", "感覚が鋭い！", "いい流れ！", "上達してる！",
    "自信持って！", "正着に近い！", "手応えあり！", "冴えてるね！"],
  GOOD: ["前向きな手だ！", "悪くない選択！", "十分戦える！", "方向性は良い！",
    "堅実な一手！", "問題ない手！", "戦いは続く！", "崩れてない！",
    "落ち着いていこう！", "地に足ついてる！", "悪くない流れ！", "これで良し！"],
  SOSO: ["まずまずの手！", "ここは我慢！", "五分の勝負！", "焦らず行こう！",
    "立て直せる！", "耐える場面だ！", "粘り強く！", "挽回できる！",
    "気持ちを保とう！", "まだ大丈夫！", "冷静にいこう！", "続けていこう！"],
  ROUGH: ["少し痛いが次！", "取り返せる！", "気持ち切り替え！", "まだ勝負だ！",
    "諦めるのは早い！", "落ち着いて挽回！", "一手ずつ丁寧に！", "顔を上げよう！",
    "巻き返しは可能！", "集中を保とう！", "深呼吸して次！", "ここから粘ろう！"],
  BLUNDER: ["次で取り返そう！", "誰にでもある！", "気を取り直そう！", "まだ諦めない！",
    "学びに変えよう！", "落ち着いて指そう！", "一手ずつ立て直し！", "顔を上げて次！",
    "勝負はこれから！", "気持ちを新たに！", "深呼吸して集中！", "前を向こう！"],
};

// フェーズ固有の本文(該当フェーズのみ候補に合流)
const _PHASE_BODY: Record<GamePhase, string[]> = {
  opening: ["展開が早い！", "センター意識いいね！", "駒組みが自然！", "出だし好調！"],
  middlegame: ["攻めの形が見えてる！", "中盤の構想が良い！", "駒がよく働いてる！",
    "主導権を握れそう！"],
  endgame: ["キングの活用が光る！", "寄せの感覚ある！", "終盤の底力！",
    "ポーンの押し上げ good！"],
};

// facts 言及句(好手時)。fact 文字列 -> 言及句リスト
const _FACT_GOOD: Record<string, string[]> = {
  "駒を取る": ["駒得もバッチリ！", "しっかり駒得！", "得したね！"],
  "王手": ["王手で圧をかけた！", "王手が刺さる！", "攻めの王手！"],
  "成る": ["昇格が決まった！", "成りで一気に有利！", "クイーン誕生！"],
  "キャスリング": ["王様の安全確保！", "キャスリング good！", "囲いが完成！"],
};

// facts 言及句(悪手時)
const _FACT_BAD: Record<string, string[]> = {
  "取られる位置(守りなし)": ["タダ取られに注意、次いこう！", "守りなしはヒヤリ、次だ！",
    "そこは危ない、切り替え！"],
};

// ストリーク時のエスカレート句
const _STREAK_BODY = ["止まらない！", "波に乗ってる！", "絶好調！", "この勢いだ！",
  "手が付けられない！", "ノリノリだね！"];

// ── web 独自拡張(序盤の定跡戦略) ────────────────────────────────────────
// 以下 2 テーブルは Python 版 coach.py には存在しない web 独自の追加。
// 選んだ定跡どおりの手を指したとき/定跡を外れて良手を指したときに言及する。

// 定跡どおりの好手(name = 定跡名を埋め込むテンプレート関数)。
const _BOOK_FOLLOW: ((name: string) => string)[] = [
  (name) => `定跡どおり！${name}の形だ！`,
  (name) => `${name}、いい駒組み！`,
  (name) => `お手本の${name}！`,
  (name) => `${name}の理想形に一歩前進！`,
];

// 定跡とは違うが良い手。
const _BOOK_DEVIATE_OK: string[] = [
  "定跡とは違うけど良い手！",
  "独自路線もアリ！",
  "その手も立派な選択！",
];

// 手ごとに褒め/励ましコメントを生成する。
export class CoachCommenter {
  private rng: Rng;
  // 直近使用の感嘆句・本文を別々に記録して連続重複を避ける(Python の deque(maxlen=4))。
  private recentExclaim: string[] = [];
  private recentBody: string[] = [];
  greenStreak = 0;

  constructor(rng: Rng = defaultRng) {
    this.rng = rng;
  }

  // rng を使った random.choice 相当。
  private choice<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // history に無い候補を優先して1つ選ぶ。無ければ全体から選ぶ。
  private pick(pool: string[], history: string[]): string {
    const fresh = pool.filter((x) => !history.includes(x));
    const chosen = this.choice(fresh.length ? fresh : pool);
    history.push(chosen);
    if (history.length > 4) history.shift(); // deque(maxlen=4)
    return chosen;
  }

  // 損失・色・事実・局面からコメント文字列を合成する。
  comment(
    loss: number,
    color: "green" | "yellow" | "red",
    facts: string[],
    board: Chess,
    // web 独自拡張。序盤の定跡戦略に応じたコメントを差し込む(省略時は現行動作)。
    opening?: { strategyName: string; openingName: string; followedBook: boolean },
  ): string {
    const tier = tierOf(loss);
    const isGreen = loss <= GREEN_MAX;
    // ストリーク更新
    if (isGreen) this.greenStreak += 1;
    else this.greenStreak = 0;

    let body: string | null = null;

    // 悪手時: タダ取られ等の警告を優先(50%)
    if (color === "red") {
      for (const f of facts) {
        if (f in _FACT_BAD && this.rng() < 0.5) {
          body = this.choice(_FACT_BAD[f]);
          break;
        }
      }
    }

    // 好手時: facts 言及句を確率的に採用(50%)
    if (body === null && isGreen) {
      const good = facts.filter((f) => f in _FACT_GOOD);
      if (good.length && this.rng() < 0.5) {
        const f = this.choice(good);
        body = this.choice(_FACT_GOOD[f]);
      }
    }

    // web 独自拡張: 序盤の定跡戦略への言及(緑系の好手時に 50% で差し替え)。
    // opening 未指定なら発火せず現行動作と完全一致。
    if (body === null && isGreen && opening !== undefined) {
      if (opening.followedBook && this.rng() < 0.5) {
        // openingName 埋め込み後の文字列で履歴回避 pick() を通す。
        const pool = _BOOK_FOLLOW.map((f) => f(opening.openingName));
        body = this.pick(pool, this.recentBody);
      } else if (!opening.followedBook && this.rng() < 0.5) {
        body = this.pick(_BOOK_DEVIATE_OK, this.recentBody);
      }
    }

    // ストリーク3連続以上でエスカレート句(50%)
    if (body === null && this.greenStreak >= 3 && this.rng() < 0.5) {
      const pool = [..._STREAK_BODY, `${this.greenStreak}連続の好手！`];
      body = this.pick(pool, this.recentBody);
    }

    // 通常本文(フェーズ固有句を合流)
    if (body === null) {
      const pool = [..._BODY[tier]];
      if (isGreen) pool.push(...(_PHASE_BODY[gamePhase(board)] ?? []));
      body = this.pick(pool, this.recentBody);
    }

    const exclaim = this.pick(_EXCLAIM[tier], this.recentExclaim);
    return `${exclaim}${body}`;
  }
}
