import { useEffect, useMemo, useState } from "react";

import { filterRepoTree, summarizeTree } from "../../lib/repoTree";
import { useAppStore } from "../../store/useAppStore";
import type { RepoFileNode } from "../../types/repo";

interface TreeNodeProps {
  node: RepoFileNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  expandedPaths,
  toggleExpanded,
  selectedFilePath,
  onSelectFile,
}: TreeNodeProps) {
  if (node.type === "dir") {
    const isExpanded = expandedPaths.has(node.path);

    return (
      <div className="repo-tree__item">
        <button
          type="button"
          className={`repo-tree__row repo-tree__row--dir ${isExpanded ? "is-expanded" : ""}`}
          onClick={() => toggleExpanded(node.path)}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
        >
          <span className="repo-tree__caret">{isExpanded ? "▾" : "▸"}</span>
          <span className="repo-tree__icon">dir</span>
          <span className="repo-tree__label">{node.name}</span>
          <span className="repo-tree__meta">{node.children?.length ?? 0}</span>
        </button>

        {isExpanded && node.children?.length ? (
          <div className="repo-tree__children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                toggleExpanded={toggleExpanded}
                selectedFilePath={selectedFilePath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const isIfc = node.extension === "ifc";
  const isSelected = selectedFilePath === node.path;

  return (
    <div className="repo-tree__item">
      <button
        type="button"
        className={`repo-tree__row repo-tree__row--file ${isSelected ? "is-selected" : ""} ${isIfc ? "is-ifc" : ""}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => {
          if (isIfc) {
            onSelectFile(node.path);
          }
        }}
      >
        <span className="repo-tree__caret repo-tree__caret--spacer" />
        <span className="repo-tree__icon">{isIfc ? "ifc" : node.extension ?? "file"}</span>
        <span className="repo-tree__label">{node.name}</span>
        {node.size ? (
          <span className="repo-tree__meta">{Math.round(node.size / 1024)} KB</span>
        ) : null}
      </button>
    </div>
  );
}

export function RepoFilesPanel() {
  const repoFileTree = useAppStore((state) => state.repoFileTree);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const setSelectedFilePath = useAppStore((state) => state.setSelectedFilePath);

  const [search, setSearch] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedPaths(
      new Set(
        repoFileTree
          .filter((node) => node.type === "dir")
          .slice(0, 6)
          .map((node) => node.path),
      ),
    );
  }, [repoFileTree]);

  const filteredTree = useMemo(() => filterRepoTree(repoFileTree, search), [repoFileTree, search]);
  const summary = useMemo(() => summarizeTree(repoFileTree), [repoFileTree]);

  const toggleExpanded = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <section className="panel panel--repo-files">
      <div className="panel__eyebrow">Repo files</div>
      <div className="repo-files__header">
        <div className="repo-files__metric">
          <span>Files</span>
          <strong>{summary.fileCount}</strong>
        </div>
        <div className="repo-files__metric">
          <span>IFC</span>
          <strong>{summary.ifcCount}</strong>
        </div>
      </div>

      <label className="repo-files__search">
        <span className="field__label">Filter tree</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search folders or files"
        />
      </label>

      <div className="repo-files__hint">
        IFC files are highlighted. Selecting one updates the active model path.
      </div>

      <div className="repo-tree">
        {filteredTree.length > 0 ? (
          filteredTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              toggleExpanded={toggleExpanded}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
            />
          ))
        ) : (
          <div className="repo-files__empty">No matching files in this commit.</div>
        )}
      </div>
    </section>
  );
}
