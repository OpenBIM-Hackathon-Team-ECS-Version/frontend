import type { GitRepoTreeEntry, RepoFileNode } from "../types/repo";

function getNameFromPath(path: string) {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function getExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) {
    return undefined;
  }

  return name.slice(lastDot + 1).toLowerCase();
}

function sortNodes(nodes: RepoFileNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "dir" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function buildRepoFileTree(entries: GitRepoTreeEntry[]) {
  const root: RepoFileNode[] = [];
  const nodeMap = new Map<string, RepoFileNode>();

  entries
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((entry) => {
      const segments = entry.path.split("/");
      let currentChildren = root;
      let currentPath = "";

      segments.forEach((segment, index) => {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const isLeaf = index === segments.length - 1;
        let node = nodeMap.get(currentPath);

        if (!node) {
          node = {
            path: currentPath,
            name: segment,
            type: isLeaf && entry.type === "blob" ? "file" : "dir",
            extension: isLeaf ? getExtension(segment) : undefined,
            sha: isLeaf ? entry.sha : undefined,
            size: isLeaf ? entry.size : undefined,
            children: isLeaf && entry.type === "blob" ? undefined : [],
          };

          nodeMap.set(currentPath, node);
          currentChildren.push(node);
        }

        if (node.type === "dir") {
          currentChildren = node.children ?? [];
          node.children = currentChildren;
        }
      });
    });

  const normalizeChildren = (nodes: RepoFileNode[]): RepoFileNode[] =>
    sortNodes(nodes).map((node) =>
      node.type === "dir" && node.children
        ? { ...node, children: normalizeChildren(node.children) }
        : node,
    );

  const tree = normalizeChildren(root);
  const fileMap = new Map<string, RepoFileNode>();

  const walk = (nodes: RepoFileNode[]) => {
    nodes.forEach((node) => {
      fileMap.set(node.path, node);
      if (node.children) {
        walk(node.children);
      }
    });
  };

  walk(tree);

  return {
    tree,
    fileMap,
  };
}

export function flattenIfcPaths(nodes: RepoFileNode[]) {
  const results: string[] = [];

  const walk = (items: RepoFileNode[]) => {
    items.forEach((node) => {
      if (node.type === "file" && node.extension === "ifc") {
        results.push(node.path);
      }

      if (node.children) {
        walk(node.children);
      }
    });
  };

  walk(nodes);
  return results;
}

export function filterRepoTree(nodes: RepoFileNode[], query: string): RepoFileNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const matchesSelf =
      node.path.toLowerCase().includes(normalizedQuery) ||
      node.name.toLowerCase().includes(normalizedQuery);

    if (node.type === "file") {
      return matchesSelf ? [node] : [];
    }

    const filteredChildren = filterRepoTree(node.children ?? [], normalizedQuery);
    if (matchesSelf || filteredChildren.length > 0) {
      return [{ ...node, children: filteredChildren }];
    }

    return [];
  });
}

export function summarizeTree(nodes: RepoFileNode[]) {
  let fileCount = 0;
  let ifcCount = 0;

  const walk = (items: RepoFileNode[]) => {
    items.forEach((node) => {
      if (node.type === "file") {
        fileCount += 1;
        if (node.extension === "ifc") {
          ifcCount += 1;
        }
      }

      if (node.children) {
        walk(node.children);
      }
    });
  };

  walk(nodes);

  return {
    fileCount,
    ifcCount,
  };
}

export function getDisplayName(path: string) {
  return getNameFromPath(path);
}
