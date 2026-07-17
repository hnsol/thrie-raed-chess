// コーチの吹き出し。人間の手を reveal した時にコメントを表示する。
// 固定高でレイアウトシフトを防ぐ(コメント無しでも高さを維持する)。
import "./CoachBubble.css";

export interface CoachBubbleProps {
  // 表示するコメント。null/空なら吹き出しは非表示(高さは維持)。
  comment: string | null;
}

export default function CoachBubble({ comment }: CoachBubbleProps) {
  return (
    <div className="coachbubble" aria-live="polite">
      {comment ? (
        <div className="coachbubble__inner">
          <span className="coachbubble__avatar" aria-hidden="true">
            🧑‍🏫
          </span>
          <span className="coachbubble__text">{comment}</span>
        </div>
      ) : null}
    </div>
  );
}
