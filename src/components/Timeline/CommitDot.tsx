import type { GitCommit } from "../../types/git";

interface CommitDotProps {
  commit: GitCommit;
  isActive: boolean;
  onClick: () => void;
}

export function CommitDot({ commit, isActive, onClick }: CommitDotProps) {
  return (
    <button
      type="button"
      className={`timeline-dot ${isActive ? "is-active" : ""}`}
      onClick={onClick}
      title={`${commit.shortSha} — ${commit.message.split("\n")[0]}`}
      aria-label={`Jump to commit ${commit.shortSha}`}
    >
      <span className="timeline-dot__inner" />
    </button>
  );
}
