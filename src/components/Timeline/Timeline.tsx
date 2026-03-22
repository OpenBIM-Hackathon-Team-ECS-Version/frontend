import { useAppStore } from "../../store/useAppStore";
import { CommitDot } from "./CommitDot";

export function Timeline() {
  const commits = useAppStore((state) => state.commits);
  const activeSha = useAppStore((state) => state.activeSha);
  const setActiveSha = useAppStore((state) => state.setActiveSha);

  return (
    <div className="panel panel--timeline">
      <div className="panel__eyebrow">Timeline</div>
      <div className="timeline-track">
        <div className="timeline-track__line" />
        <div className="timeline-track__dots">
          {commits.map((commit) => (
            <CommitDot
              key={commit.sha}
              commit={commit}
              isActive={commit.sha === activeSha}
              onClick={() => setActiveSha(commit.sha)}
            />
          ))}
        </div>
      </div>
      <div className="timeline-caption">
        {activeSha
          ? commits.find((commit) => commit.sha === activeSha)?.message.split("\n")[0]
          : "Connect a repository to scrub model history."}
      </div>
    </div>
  );
}
