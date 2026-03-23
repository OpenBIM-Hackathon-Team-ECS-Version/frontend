import { importBcfProject, listTopics, parseTopicMetadata } from "./bcf";
import { fetchRepoFileBuffer, getFileCommitHistory } from "./github";

import type { BCFTopic } from "../types/bcf";
import type { GitCommit, RepoRef } from "../types/git";

export type TopicHistoryEntry = {
  commit: GitCommit;
  topic: BCFTopic;
};

export type TopicHistoryMap = Map<string, TopicHistoryEntry[]>;

export type TopicLifecycle = {
  topic: BCFTopic;
  visibleCommitShas: string[];
};

export function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function getTopicAnchorTimestamp(topic: BCFTopic) {
  const creationTimestamp = parseTimestamp(topic.creationDate);
  if (creationTimestamp !== null) {
    return creationTimestamp;
  }

  const modifiedTimestamp = parseTimestamp(topic.modifiedDate);
  if (modifiedTimestamp !== null) {
    return modifiedTimestamp;
  }

  const commentTimestamps = topic.comments
    .map((comment) => parseTimestamp(comment.modifiedDate ?? comment.date))
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => right - left);

  return commentTimestamps[0] ?? null;
}

export function resolveTopicCommitSha(
  topic: BCFTopic,
  versions: GitCommit[],
  topicHistoryByGuid: TopicHistoryMap,
) {
  const metadata = parseTopicMetadata(topic);
  if (metadata.activeSha && versions.some((commit) => commit.sha === metadata.activeSha)) {
    return metadata.activeSha;
  }

  const historicalEntries = topicHistoryByGuid.get(topic.guid);
  const historicalBcfCommit = historicalEntries?.[0]?.commit ?? null;
  if (historicalBcfCommit) {
    if (versions.some((commit) => commit.sha === historicalBcfCommit.sha)) {
      return historicalBcfCommit.sha;
    }

    const historicalTimestamp = parseTimestamp(historicalBcfCommit.authoredAt);
    if (historicalTimestamp !== null) {
      const matchingModelCommit = [...versions]
        .reverse()
        .find((commit) => {
          const authoredTimestamp = parseTimestamp(commit.authoredAt);
          return authoredTimestamp !== null && authoredTimestamp <= historicalTimestamp;
        });

      if (matchingModelCommit) {
        return matchingModelCommit.sha;
      }
    }
  }

  const anchorTimestamp = getTopicAnchorTimestamp(topic);
  if (anchorTimestamp === null || versions.length === 0) {
    return null;
  }

  const latestCommitAtOrBeforeTopic = [...versions]
    .reverse()
    .find((commit) => {
      const authoredTimestamp = parseTimestamp(commit.authoredAt);
      return authoredTimestamp !== null && authoredTimestamp <= anchorTimestamp;
    });

  return latestCommitAtOrBeforeTopic?.sha ?? versions[0]?.sha ?? null;
}

export function resolveHistoryCommitSha(commit: GitCommit, versions: GitCommit[]) {
  if (versions.some((entry) => entry.sha === commit.sha)) {
    return commit.sha;
  }

  const historicalTimestamp = parseTimestamp(commit.authoredAt);
  if (historicalTimestamp === null) {
    return null;
  }

  const matchingModelCommit = [...versions]
    .reverse()
    .find((entry) => {
      const authoredTimestamp = parseTimestamp(entry.authoredAt);
      return authoredTimestamp !== null && authoredTimestamp <= historicalTimestamp;
    });

  return matchingModelCommit?.sha ?? null;
}

export function isResolvedStatus(status: string | undefined) {
  if (!status) {
    return false;
  }

  const normalized = status.trim().toLowerCase();
  return normalized === "resolved" || normalized === "closed" || normalized === "done";
}

export function buildTopicLifecycle(
  topic: BCFTopic,
  versions: GitCommit[],
  topicHistoryByGuid: TopicHistoryMap,
) {
  const anchorSha = resolveTopicCommitSha(topic, versions, topicHistoryByGuid);
  if (!anchorSha) {
    return null;
  }

  const startIndex = versions.findIndex((commit) => commit.sha === anchorSha);
  if (startIndex < 0) {
    return null;
  }

  const history = topicHistoryByGuid.get(topic.guid) ?? [];
  const resolvedEntry = history.find((entry) => isResolvedStatus(entry.topic.topicStatus));

  let endIndex = versions.length - 1;
  if (resolvedEntry) {
    const resolvedSha = resolveHistoryCommitSha(resolvedEntry.commit, versions);
    const resolvedIndex = resolvedSha ? versions.findIndex((commit) => commit.sha === resolvedSha) : -1;
    if (resolvedIndex >= startIndex) {
      endIndex = resolvedIndex;
    }
  } else if (isResolvedStatus(topic.topicStatus)) {
    endIndex = startIndex;
  }

  return {
    topic,
    visibleCommitShas: versions.slice(startIndex, endIndex + 1).map((commit) => commit.sha),
  } satisfies TopicLifecycle;
}

export function getTopicStateAtCommit(
  topic: BCFTopic,
  activeSha: string,
  versions: GitCommit[],
  topicHistoryByGuid: TopicHistoryMap,
) {
  const activeIndex = versions.findIndex((commit) => commit.sha === activeSha);
  if (activeIndex < 0) {
    return topic;
  }

  const history = topicHistoryByGuid.get(topic.guid) ?? [];
  let effectiveTopic: BCFTopic = topic;
  let effectiveIndex = -1;

  history.forEach((entry) => {
    const entrySha = resolveHistoryCommitSha(entry.commit, versions);
    if (!entrySha) {
      return;
    }

    const entryIndex = versions.findIndex((commit) => commit.sha === entrySha);
    if (entryIndex < 0 || entryIndex > activeIndex || entryIndex < effectiveIndex) {
      return;
    }

    effectiveTopic = entry.topic;
    effectiveIndex = entryIndex;
  });

  return effectiveTopic;
}

export async function buildTopicHistoryByGuid(params: {
  authToken?: string;
  bcfPath: string;
  bcfRef: string;
  repo: RepoRef;
  topics: BCFTopic[];
}) {
  const { authToken, bcfPath, bcfRef, repo, topics } = params;
  const topicGuids = new Set(topics.map((topic) => topic.guid));
  const bcfHistory = await getFileCommitHistory(repo, bcfRef, bcfPath, authToken, 20);
  const historyByGuid: TopicHistoryMap = new Map();
  const chronologicalHistory = bcfHistory.slice().reverse();

  for (const commit of chronologicalHistory) {
    const buffer = await fetchRepoFileBuffer(repo, commit.sha, bcfPath, authToken);
    const historicalProject = await importBcfProject(buffer);

    listTopics(historicalProject).forEach((topic) => {
      if (!topicGuids.has(topic.guid)) {
        return;
      }

      const existing = historyByGuid.get(topic.guid) ?? [];
      existing.push({ commit, topic });
      historyByGuid.set(topic.guid, existing);
    });
  }

  return historyByGuid;
}
